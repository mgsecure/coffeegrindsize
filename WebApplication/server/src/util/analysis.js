import sharp from 'sharp';
import { logger } from '../logger/logger.js';

/**
 * Perform coffee grind size analysis on an image buffer.
 */
export async function analyzeImage(buffer, options = {}) {
  try {
    if (!buffer || !(buffer instanceof Buffer) || buffer.length === 0) {
      throw new Error('Empty or invalid image buffer');
    }
    const {
      threshold = 58.8,
      maxClusterAxis = 2,
      minSurface = 0.05,
      maxSurface = 10,
      minRoundness = 0,
      quick = true,
      debug = false,
      minInnerRatio = 0.5,
      maxInnerRatio = 0.99,
      // Sanity thresholds for detected outer diameter (to avoid tiny false detections)
      // minDetectedOuterFraction: minimum fraction of expectedOuterDiameterPx (e.g. 0.6 = 60%)
      // minOuterImgFraction: minimum fraction of the image minimum dimension (e.g. 0.1 = 10%)
      minDetectedOuterFraction = 0.6,
      minOuterImgFraction = 0.1,
      // Calibration and reference options (configurable)
      expectedOuterDiameterPx = 1744, // outside diameter in pixels (default measured target)
      expectedInnerDiameterPx = 1580, // inside diameter in pixels
      outerDiameterMm = 93, // physical outer diameter in mm
      diameterTolerancePx = 10, // tolerance to decide whether to trust detected diameter
      edgeTolerancePx = 1.5, // pixels near inner/outer boundaries considered "edge"
      // referenceMode: 'auto' | 'fixed' | 'detected'
      // 'auto' = prefer detected if close to expected, otherwise use expected
      // 'fixed' = always use expected diameters
      // 'detected' = always use detected diameter (fall back to expected if detection fails)
      // default to detected to prefer measured values from each image
      referenceMode = 'detected',
    } = options;

    // 1. Load image and get blue channel
    const image = sharp(buffer);
    const metadata = await image.metadata();
    const { width, height } = metadata;

    if (!width || !height) {
      throw new Error('Invalid image metadata: missing width/height');
    }

    const rawBlue = await image
      .extractChannel('blue')
      .raw()
      .toBuffer();

    let data = new Uint8Array(rawBlue);

    // Allow rawBlue to be equal or larger than width*height (some images may include extra padding);
    // if larger, truncate to the expected pixel count so downstream code works reliably.
    const expectedLen = width * height;
    if (!data || data.length < expectedLen) {
      throw new Error(`Unexpected raw channel length (${data ? data.length : 0}) for image ${width}x${height}`);
    }
    if (data.length > expectedLen) {
      data = data.slice(0, expectedLen);
    }
    // 1.1 Detect 93mm circle / annulus for pixel scale
    let medianInitial = calculateMedian(data);
    // First run the box-based detector to get a reliable center candidate.
    const boxCircle = detectReferenceCircle(data, width, height, medianInitial);
    let circleInfo = null;
    let detectorUsed = null; // 'gradient' | 'radial' | 'avg' | 'box' | null
    let fallbackUsed = false;

    // Try gradient-based detector first (most robust across scales)
    try {
      const center = boxCircle ? boxCircle.center : null;
      const grad = detectAnnulusByGradientRadial(data, width, height, medianInitial, center, {});
      if (grad) {
        circleInfo = grad;
        detectorUsed = 'gradient';
      }
    } catch (e) {
      // ignore and try next
    }

    // If gradient didn't find anything, try radial-profile detector
    if (!circleInfo) {
      const center = boxCircle ? boxCircle.center : null;
      const radial = detectAnnulusByRadialProfile(data, width, height, medianInitial, center, { expectedOuterDiameterPx, minDetectedOuterFraction, minOuterImgFraction });
      if (radial) {
        circleInfo = radial;
        detectorUsed = 'radial';
      }
    }

    // If radial-profile detection yields a very small diameter (likely a false positive), try radial-average fallback
    if (circleInfo && typeof circleInfo.diameterPixels === 'number') {
      const minByExpected = expectedOuterDiameterPx * minDetectedOuterFraction;
      const minByImage = Math.min(width, height) * minOuterImgFraction;
      const minAllowed = Math.max(1, Math.round(Math.max(minByExpected, minByImage)));
      if (circleInfo.diameterPixels < minAllowed) {
        const avg = detectAnnulusByRadialProfileAvg(data, width, height, medianInitial, circleInfo.center || (boxCircle && boxCircle.center) || null, { expectedOuterDiameterPx, minDetectedOuterFraction, minOuterImgFraction });
        if (avg && avg.diameterPixels >= minAllowed) {
          logger.info({ measuredOuterPx: circleInfo.diameterPixels, fallbackOuterPx: avg.diameterPixels, minAllowed }, 'Radial-average fallback found a larger annulus and will be used');
          circleInfo = avg;
          detectorUsed = detectorUsed || 'avg';
          fallbackUsed = true;
        } else {
          logger.warn({ measuredOuterPx: circleInfo.diameterPixels, minAllowed }, 'Detected outer diameter is implausibly small and fallback did not find a better annulus');
        }
      }
    }

    // If still no detection, fall back to boxCircle (large blob detector)
    if (!circleInfo && boxCircle) {
      circleInfo = boxCircle;
      detectorUsed = detectorUsed || 'box';
    }

    // Decide on pixel scale and annulus radii using configurable options
    const measuredOuterPx = circleInfo ? circleInfo.diameterPixels : null;
    const measuredInnerPx = circleInfo ? (circleInfo.innerDiameterPixels || null) : null;
    // expose whether fallback was used for debug
    const initialFallbackUsed = fallbackUsed;
    const usedDetector = detectorUsed;
    let circleCenter = circleInfo ? circleInfo.center : null;
    let outerDiameterPx;
    // Scale inner diameter proportionally if the used outer diameter differs from the
    // expectedOuterDiameterPx. This keeps the same inner/outer ratio even when we use a
    // detected outer diameter.
    let innerDiameterPx = expectedInnerDiameterPx;
    const analysisRegion = circleInfo ? circleInfo.region : null;

    // Choose outer diameter based on referenceMode
    if (referenceMode === 'fixed') {
      outerDiameterPx = Math.min(expectedOuterDiameterPx, Math.floor(Math.min(width, height) * 0.98));
    } else if (referenceMode === 'detected') {
      if (!measuredOuterPx) {
        logger.warn('Reference mode=detected but no circle detected; falling back to expectedOuterDiameterPx (clamped to image size)');
        outerDiameterPx = Math.min(expectedOuterDiameterPx, Math.floor(Math.min(width, height) * 0.98));
      } else {
        // Per-user request: when referenceMode is 'detected' prefer measured values unconditionally.
        outerDiameterPx = measuredOuterPx;
      }
    } else { // 'auto'
      if (!measuredOuterPx) {
        outerDiameterPx = Math.min(expectedOuterDiameterPx, Math.floor(Math.min(width, height) * 0.98));
      } else if (Math.abs(measuredOuterPx - expectedOuterDiameterPx) > diameterTolerancePx) {
        logger.warn(`Detected circle diameter (${Math.round(measuredOuterPx)} px) differs from expected (${expectedOuterDiameterPx} px) by more than ${diameterTolerancePx}px; using expected value for scale.`);
        outerDiameterPx = Math.min(expectedOuterDiameterPx, Math.floor(Math.min(width, height) * 0.98));
      } else {
        outerDiameterPx = measuredOuterPx;
      }
    }

    const pixelScale = outerDiameterPx / outerDiameterMm;
    const circleRadius = outerDiameterPx / 2;
    if (!circleCenter) circleCenter = { x: width / 2, y: height / 2 };
    // If detection provided an inner diameter, prefer it (when using detected mode);
    // otherwise scale the expected inner diameter proportionally to the chosen outer diameter.
    if (measuredInnerPx) {
      innerDiameterPx = measuredInnerPx;
    } else if (expectedOuterDiameterPx && expectedOuterDiameterPx > 0) {
      innerDiameterPx = Math.round(expectedInnerDiameterPx * (outerDiameterPx / expectedOuterDiameterPx));
    }

    logger.info({ calibration: { measuredOuterPx, outerDiameterPx, innerDiameterPx, outerDiameterMm, pixelScale, referenceMode } }, 'Calibration chosen');

    // Sanity-check measured inner diameter (if any) — ensure it's a reasonable fraction of the outer diameter.
    if (measuredInnerPx) {
      const measuredInnerRatio = measuredInnerPx / outerDiameterPx;
      if (referenceMode === 'detected') {
        // Per-user request: in 'detected' mode prefer measured inner diameter unconditionally.
        innerDiameterPx = measuredInnerPx;
      } else {
        // Accept inner diameter only if it's between configurable minInnerRatio and maxInnerRatio
        if (measuredInnerRatio < minInnerRatio || measuredInnerRatio > maxInnerRatio) {
          logger.warn({ measuredInnerPx, outerDiameterPx, measuredInnerRatio, minInnerRatio, maxInnerRatio }, 'Measured inner diameter rejected as implausible; falling back to scaled expected inner diameter');
          // Reject it — fall back to proportionally scaled expected inner diameter
          if (expectedOuterDiameterPx && expectedOuterDiameterPx > 0) {
            innerDiameterPx = Math.round(expectedInnerDiameterPx * (outerDiameterPx / expectedOuterDiameterPx));
          } else {
            // fallback to a conservative inner diameter (90% of outer)
            innerDiameterPx = Math.round(outerDiameterPx * 0.9);
          }
        } else {
          // measuredInnerPx seems reasonable — use it
          innerDiameterPx = measuredInnerPx;
        }
      }
    }

    // Recompute radii after any potential adjustment to innerDiameterPx
    const innerRadius = innerDiameterPx / 2;
    const outerRadius = circleRadius;

    // Convert mm parameters to pixels if pixelScale is available
    const internalPixelScale = pixelScale || 22.65; // Fallback
    const maxClusterAxisPx = maxClusterAxis * internalPixelScale;
    const minSurfacePx = minSurface * (internalPixelScale ** 2);
    const maxSurfacePx = maxSurface * (internalPixelScale ** 2);

    // Recalculate median within analysis region if possible
    const median = analysisRegion ? calculateMedian(data, analysisRegion, width) : medianInitial;

    // 3. Thresholding
    const thresholdValue = (median * threshold) / 100;
    const mask = new Uint8Array(data.length);
    const thresholdedIndices = [];
    const edgePixels = new Set();
    let totalThresholded = 0;
    let thresholdedInsideInner = 0;

    for (let i = 0; i < data.length; i++) {
      const x = i % width;
      const y = Math.floor(i / width);
      // compute squared distance to center if center exists, else null
      let dist2 = null;
      if (circleCenter && innerRadius != null) {
        const dx = x - circleCenter.x;
        const dy = y - circleCenter.y;
        dist2 = dx * dx + dy * dy;
      }

      // If analysisRegion is set, only consider pixels inside
      // New behavior: only analyze pixels inside the inner circle (particles must be within the inner diameter)
      if (dist2 !== null) {
        // Only consider pixels inside the inner circle
        if (dist2 > innerRadius * innerRadius) continue;

        // Mark pixels close to the inner boundary as edge pixels so clusters touching
        // the analysis boundary are excluded later. Use configured tolerance.
        const TOL = edgeTolerancePx;
        if (dist2 > (innerRadius - TOL) * (innerRadius - TOL)) {
          if (data[i] < thresholdValue) {
            edgePixels.add(i);
          }
        }
      } else {
         // If no analysis region, edge of image is the edge
         if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
           if (data[i] < thresholdValue) {
             edgePixels.add(i);
           }
         }
       }

       if (data[i] < thresholdValue) {
         mask[i] = 1;
         thresholdedIndices.push(i);
         totalThresholded++;
         // Count how many thresholded pixels are inside the inner radius
         if (dist2 !== null && dist2 <= innerRadius * innerRadius) thresholdedInsideInner++;
       }
    }

    // 4. Segmentation
    const visited = new Uint8Array(data.length);
    const clusters = [];

    const thresholdImageBuffer = new Uint8Array(width * height * 3);
    const outlinesImageBuffer = new Uint8Array(width * height * 3);

    for (let i = 0; i < data.length; i++) {
      thresholdImageBuffer[i * 3] = data[i];
      thresholdImageBuffer[i * 3 + 1] = data[i];
      thresholdImageBuffer[i * 3 + 2] = data[i];

      outlinesImageBuffer[i * 3] = data[i];
      outlinesImageBuffer[i * 3 + 1] = data[i];
      outlinesImageBuffer[i * 3 + 2] = data[i];
    }

    for (const index of thresholdedIndices) {
      thresholdImageBuffer[index * 3] = 255;
      thresholdImageBuffer[index * 3 + 1] = 0;
      thresholdImageBuffer[index * 3 + 2] = 0;
    }

    // Sort thresholded indices by brightness to match Python (darkest first)
    thresholdedIndices.sort((a, b) => data[a] - data[b]);

    for (const index of thresholdedIndices) {
      if (visited[index]) continue;

      let cluster = [];
      let queue = [index];
      visited[index] = 1;
      let isOnEdge = false;

      // Use a Set for fast checking of current cluster members if needed
      // But BFS naturally handles connection.
      // The "cost" logic in Python is a bit more than just BFS.
      // It's a "clump breakup" step.

      while (queue.length > 0) {
        const curr = queue.shift();
        cluster.push(curr);
        if (edgePixels.has(curr)) isOnEdge = true;

        const x = curr % width;
        const y = Math.floor(curr / width);

        const neighbors = [
          [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]
        ];

        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nIdx = ny * width + nx;
            if (mask[nIdx] && !visited[nIdx]) {
              // Distance check to avoid huge clusters early if we want to match Python's max_cluster_axis
              const nx_val = nIdx % width;
              const ny_val = Math.floor(nIdx / width);
              const start_x = index % width;
              const start_y = Math.floor(index / width);
              if ((nx_val - start_x) ** 2 + (ny_val - start_y) ** 2 <= maxClusterAxisPx ** 2) {
                visited[nIdx] = 1;
                queue.push(nIdx);
              }
            }
          }
        }
      }

      if (!quick && cluster.length > 1) {
        cluster = breakClump(cluster, index, data, width, height, median, { ...options, maxClusterAxisPx });

        // If we broke up a clump, we MUST re-verify if the new smaller cluster still touches the edge.
        // The original clump might have touched the edge, but this piece might not.
        // Conversely, the original start pixel might not have reached the edge, but
        // the broken piece might include pixels that were edgePixels but were not reached
        // during the initial BFS because of the distance limit.
        // Actually, if we didn't reach them during BFS, they won't be in 'cluster' anyway.

        // So if we are in breakClump mode, we recalculate isOnEdge for the final piece.
        isOnEdge = false;
        for (const pIdx of cluster) {
          if (edgePixels.has(pIdx)) {
            isOnEdge = true;
            break;
          }
        }
      }

      // Ensure the cluster is fully inside the analysis circle (not touching the inner boundary)
      if (!isOnEdge && cluster.length >= 1 && isClusterFullyWithinCircle(cluster, circleCenter, innerRadius, width, edgeTolerancePx)) {
        const metrics = calculateClusterMetrics(cluster, width, height, data, median, pixelScale);
        if (metrics.longAxisPx * 2 <= maxClusterAxisPx &&
            metrics.surfacePx >= minSurfacePx &&
            metrics.surfacePx <= maxSurfacePx &&
            metrics.roundness >= minRoundness) {
          clusters.push(metrics);
          drawOutline(outlinesImageBuffer, cluster, width, height);
        }
      }
    }

    // Draw circle detection for feedback
    if (circleCenter && outerRadius != null && innerRadius != null) {
      // Outer circle (blue)
      drawCircle(outlinesImageBuffer, circleCenter, outerRadius, width, height, [0, 0, 255]);
      // Inner circle (red)
      drawCircle(outlinesImageBuffer, circleCenter, innerRadius, width, height, [255, 0, 0]);
    }

    const thresholdImageBase64 = await sharp(thresholdImageBuffer, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer()
      .then(b => b.toString('base64'));

    const outlinesImageBase64 = await sharp(outlinesImageBuffer, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer()
      .then(b => b.toString('base64'));

    // Compute summary statistics (D10/D50/D90, mode, mean, stdDev) on particle diameters (mm)
    let statistics = null;
    if (clusters.length > 0) {
      const diameters = clusters.map(p => p.diameterMm).filter(d => Number.isFinite(d)).sort((a,b)=>a-b);
      const n = diameters.length;

      const quantile = (arr, q) => {
        if (arr.length === 0) return 0;
        const pos = (arr.length - 1) * q;
        const lower = Math.floor(pos);
        const upper = Math.ceil(pos);
        if (lower === upper) return arr[lower];
        const weight = pos - lower;
        return arr[lower] * (1 - weight) + arr[upper] * weight;
      };

      const D10 = quantile(diameters, 0.10);
      const D50 = quantile(diameters, 0.50);
      const D90 = quantile(diameters, 0.90);

      // Mean
      const mean = diameters.reduce((s, v) => s + v, 0) / n;
      // Sample standard deviation (n>1)
      const variance = n > 1 ? diameters.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
      const stdDev = Math.sqrt(variance);

      // Mode via histogram (100 bins or fewer if small sample)
      const bins = Math.min(100, Math.max(10, Math.round(Math.sqrt(n))));
      const minD = diameters[0];
      const maxD = diameters[diameters.length -1];
      const binCounts = new Array(bins).fill(0);
      const binWidth = (maxD - minD) / bins || 1;
      for (const d of diameters) {
        const idx = Math.min(bins - 1, Math.floor((d - minD) / binWidth));
        binCounts[idx]++;
      }
      let maxIdx = 0;
      for (let i=1;i<bins;i++) if (binCounts[i] > binCounts[maxIdx]) maxIdx = i;
      const mode = minD + (maxIdx + 0.5) * binWidth;

      statistics = {
        count: n,
        mean,
        stdDev,
        mode,
        D10,
        D50,
        D90,
      };
    }

    const result = {
      width,
      height,
      median,
      thresholdValue,
      pixelScale,
      particleCount: clusters.length,
      particles: clusters,
      thresholdImage: `data:image/png;base64,${thresholdImageBase64}`,
      outlinesImage: `data:image/png;base64,${outlinesImageBase64}`,
      statistics,
      // Expose used calibration values
      calibration: {
        measuredOuterPx: measuredOuterPx,
        outerDiameterPx,
        innerDiameterPx,
        outerDiameterMm,
        diameterTolerancePx,
        edgeTolerancePx,
        referenceMode,
      },
      debug: debug ? {
        totalThresholded,
        thresholdedInsideInner,
        analysisRegion,
        measuredOuterPx,
        measuredInnerPx,
        usedInnerDiameterPx: innerDiameterPx,
        usedOuterDiameterPx: outerDiameterPx,
        fallbackUsed: initialFallbackUsed,
        detectorUsed: usedDetector
       } : undefined,
    };

    // If debug is enabled, write a debug JSON to /tmp so the runner can pick it up even if stdout is suppressed
    if (debug) {
      try {
        const fs = await import('fs');
        const path = `/tmp/analysis_debug_${Date.now()}.json`;
        fs.writeFileSync(path, JSON.stringify(result, null, 2));
      } catch (e) {
        // ignore file write errors
      }
    }

    return result;
  } catch (err) {
    // Log internal errors with stack for server-side troubleshooting and rethrow
    try { logger.error({ err: err.message, stack: err.stack }, 'analyzeImage internal error'); } catch (e) { console.error('Failed to log via logger:', e); }
    throw err;
  }
}

// Helper: ensure every pixel in the cluster lies strictly within the analysis circle
function isClusterFullyWithinCircle(cluster, center, radius, width, edgeTolerancePx) {
  const TOL = edgeTolerancePx;
  const maxAllowedR2 = (radius - TOL) * (radius - TOL);
  for (const idx of cluster) {
    const x = idx % width;
    const y = Math.floor(idx / width);
    const dx = x - center.x;
    const dy = y - center.y;
    const d2 = dx * dx + dy * dy;
    // if any pixel is outside the shrunk radius (i.e., too close to the boundary), reject
    if (d2 >= maxAllowedR2) return false;
  }
  return true;
}

function detectReferenceCircle(data, width, height, median) {
  // Use a lower threshold to find the dark circle
  const circleThreshold = (median * 40) / 100;
  const visited = new Uint8Array(data.length);
  let bestCircle = null;

  for (let i = 0; i < data.length; i += 5) { // Sampling for speed
    if (data[i] < circleThreshold && !visited[i]) {
      const cluster = [];
      const queue = [i];
      visited[i] = 1;
      let minX = i % width, maxX = i % width, minY = Math.floor(i / width), maxY = Math.floor(i / width);

      while (queue.length > 0) {
        const curr = queue.shift();
        cluster.push(curr);
        const x = curr % width;
        const y = Math.floor(curr / width);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;

        const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nIdx = ny * width + nx;
            if (data[nIdx] < circleThreshold && !visited[nIdx]) {
              visited[nIdx] = 1;
              queue.push(nIdx);
            }
          }
        }
      }

      const w = maxX - minX;
      const h = maxY - minY;
      const area = cluster.length;
      const aspectRatio = w / h;

      // Circularity approximation: 4 * PI * Area / Perimeter^2.
      // For a circle outline, area is small compared to bounding box.
      // 93mm circle should be large.
      if (w > 500 && h > 500 && aspectRatio > 0.8 && aspectRatio < 1.2) {
        // Refine diameter using density distribution
        const xCounts = new Int32Array(maxX - minX + 1);
        const yCounts = new Int32Array(maxY - minY + 1);
        for (const idx of cluster) {
          xCounts[(idx % width) - minX]++;
          yCounts[Math.floor(idx / width) - minY]++;
        }

        const findRobustEdge = (counts, totalArea) => {
          const threshold = totalArea * 0.001;
          let start = 0;
          while (start < counts.length && counts[start] < threshold) start++;
          let end = counts.length - 1;
          while (end >= 0 && counts[end] < threshold) end--;
          return { start, end, length: end - start };
        };

        const robustX = findRobustEdge(xCounts, area);
        const robustY = findRobustEdge(yCounts, area);

        if (!bestCircle || area > bestCircle.area) {
          bestCircle = {
            area,
            w: robustX.length,
            h: robustY.length,
            centerX: minX + robustX.start + robustX.length / 2,
            centerY: minY + robustY.start + robustY.length / 2,
            region: { xMin: minX, xMax: maxX, yMin: minY, yMax: maxY }
          };
        }
      }
    }
  }

  if (bestCircle) {
    return {
      diameterPixels: (bestCircle.w + bestCircle.h) / 2,
      center: { x: bestCircle.centerX, y: bestCircle.centerY },
      region: bestCircle.region
    };
  }
  return null;
}

function detectAnnulusByRadialProfile(data, width, height, median, center = null) {
  // Robust radial sampling to find dark annulus (outer and inner edges).
  // 'center' may be provided (object {x,y}) to sample around a refined center.
  const cx = center && typeof center.x === 'number' ? Math.round(center.x) : Math.round(width / 2);
  const cy = center && typeof center.y === 'number' ? Math.round(center.y) : Math.round(height / 2);
  const maxR = Math.floor(Math.min(width, height) / 2);
  const circleThreshold = (median * 40) / 100; // darker than this indicates annulus

  const angles = [];
  // sample every 3 degrees by default
  for (let a = 0; a < 360; a += 3) angles.push((a * Math.PI) / 180);

  const outerRadii = [];
  const innerRadii = [];

  for (const theta of angles) {
    // sample along the ray
    let inDark = false;
    let firstDark = null;
    let lastDark = null;
    for (let r = 0; r <= maxR; r++) {
      const x = Math.round(cx + r * Math.cos(theta));
      const y = Math.round(cy + r * Math.sin(theta));
      if (x < 0 || x >= width || y < 0 || y >= height) break;
      const v = data[y * width + x];
      if (v < circleThreshold) {
        if (!inDark) {
          inDark = true;
          firstDark = r;
        }
        lastDark = r;
      } else {
        if (inDark) {
          // dark region ended; record and break to next angle
          break;
        }
      }
    }
    if (firstDark !== null && lastDark !== null && lastDark - firstDark >= Math.max(2, Math.round(maxR * 0.01))) {
      outerRadii.push(lastDark);
      innerRadii.push(firstDark);
    }
  }

  if (outerRadii.length < Math.max(8, angles.length * 0.25)) return null; // insufficient samples

  // Take robust median of radii
  outerRadii.sort((a, b) => a - b);
  innerRadii.sort((a, b) => a - b);
  const medianOuter = outerRadii[Math.floor(outerRadii.length / 2)];
  const medianInner = innerRadii[Math.floor(innerRadii.length / 2)];

  const diameterOuter = medianOuter * 2;
  const diameterInner = Math.max(0, medianInner * 2);

  return {
    diameterPixels: diameterOuter,
    innerDiameterPixels: diameterInner,
    center: { x: cx, y: cy },
    region: { xMin: cx - medianOuter, xMax: cx + medianOuter, yMin: cy - medianOuter, yMax: cy + medianOuter }
  };
}

function detectAnnulusByRadialProfileAvg(data, width, height, median, center = null, opts = {}) {
  // Radial-average fallback: compute mean intensity per radius and find the largest dark annulus.
  const cx = center && typeof center.x === 'number' ? Math.round(center.x) : Math.round(width / 2);
  const cy = center && typeof center.y === 'number' ? Math.round(center.y) : Math.round(height / 2);
  const maxR = Math.floor(Math.min(width, height) / 2);
  const circleThreshold = (median * 40) / 100; // same threshold
  const angles = [];
  for (let a = 0; a < 360; a += 3) angles.push((a * Math.PI) / 180);

  // Initialize sums/counts per radius
  const sums = new Float64Array(maxR + 1);
  const counts = new Int32Array(maxR + 1);

  for (const theta of angles) {
    for (let r = 0; r <= maxR; r++) {
      const x = Math.round(cx + r * Math.cos(theta));
      const y = Math.round(cy + r * Math.sin(theta));
      if (x < 0 || x >= width || y < 0 || y >= height) break;
      const v = data[y * width + x];
      sums[r] += v;
      counts[r]++;
    }
  }

  // compute mean intensity per radius
  const mean = new Float64Array(maxR + 1);
  for (let r = 0; r <= maxR; r++) {
    mean[r] = counts[r] > 0 ? sums[r] / counts[r] : 255;
  }

  // Find intervals where mean < circleThreshold
  const intervals = [];
  let inDark = false;
  let start = 0;
  for (let r = 0; r <= maxR; r++) {
    if (mean[r] < circleThreshold) {
      if (!inDark) { inDark = true; start = r; }
    } else {
      if (inDark) { intervals.push({start, end: r - 1}); inDark = false; }
    }
  }
  if (inDark) intervals.push({ start, end: maxR });

  if (intervals.length === 0) return null;

  // choose the interval with the largest end radius (outermost dark ring)
  intervals.sort((a, b) => b.end - a.end);
  const chosen = intervals[0];
  const outerR = chosen.end;
  const innerR = chosen.start;

  const diameterOuter = outerR * 2;
  const diameterInner = Math.max(0, innerR * 2);

  return {
    diameterPixels: diameterOuter,
    innerDiameterPixels: diameterInner,
    center: { x: cx, y: cy },
    region: { xMin: cx - outerR, xMax: cx + outerR, yMin: cy - outerR, yMax: cy + outerR }
  };
}

function detectAnnulusByGradientRadial(data, width, height, median, center = null, opts = {}) {
  // Gradient-based radial detector: looks for strong negative gradient (bright->dark) along rays
  // which commonly corresponds to the outer edge of a dark annulus.
  const cx = center && typeof center.x === 'number' ? Math.round(center.x) : Math.round(width / 2);
  const cy = center && typeof center.y === 'number' ? Math.round(center.y) : Math.round(height / 2);
  const maxR = Math.floor(Math.min(width, height) / 2);
  const circleThreshold = (median * 40) / 100;
  const angles = [];
  // denser sampling for better robustness
  for (let a = 0; a < 360; a += 1) angles.push((a * Math.PI) / 180);

  const outerCandidates = [];
  const innerCandidates = [];

  for (const theta of angles) {
    const vals = [];
    const coords = [];
    for (let r = 0; r <= maxR; r++) {
      const x = Math.round(cx + r * Math.cos(theta));
      const y = Math.round(cy + r * Math.sin(theta));
      if (x < 0 || x >= width || y < 0 || y >= height) break;
      vals.push(data[y * width + x]);
      coords.push({ x, y, r });
    }
    if (vals.length < 10) continue;

    // compute discrete gradient
    let bestGrad = 0;
    let bestR = null;
    for (let i = 1; i < vals.length - 1; i++) {
      // central difference
      const grad = vals[i + 1] - vals[i - 1];
      // We're looking for a large negative gradient (bright->dark)
      if (grad < bestGrad) {
        bestGrad = grad;
        bestR = coords[i].r;
      }
    }

    // inner dark start: first radius where value < circleThreshold
    let firstDark = null;
    for (let i = 0; i < vals.length; i++) {
      if (vals[i] < circleThreshold) { firstDark = coords[i].r; break; }
    }

    if (bestR !== null) {
      // require that the edge candidate is reasonably dark and beyond a minimal radius
      const idx = Math.min(vals.length - 1, Math.round(bestR));
      if (vals[idx] < circleThreshold || (firstDark !== null && bestR >= firstDark)) {
        outerCandidates.push(bestR);
        if (firstDark !== null) innerCandidates.push(firstDark);
      }
    }
  }

  if (outerCandidates.length < Math.max(8, angles.length * 0.2)) return null;

  // robust median and MAD filter to remove outliers
  outerCandidates.sort((a, b) => a - b);
  const medianOuter = outerCandidates[Math.floor(outerCandidates.length / 2)];
  const diffs = outerCandidates.map(v => Math.abs(v - medianOuter));
  diffs.sort((a, b) => a - b);
  const mad = diffs[Math.floor(diffs.length / 2)] || 1;
  // keep candidates within 3*MAD
  const filtered = outerCandidates.filter(v => Math.abs(v - medianOuter) <= Math.max(3 * mad, 5));
  if (filtered.length < Math.max(8, angles.length * 0.2)) return null;

  const finalOuter = filtered.sort((a,b)=>a-b)[Math.floor(filtered.length / 2)];

  // inner radius median if available
  let finalInner = null;
  if (innerCandidates.length > 0) {
    innerCandidates.sort((a,b)=>a-b);
    finalInner = innerCandidates[Math.floor(innerCandidates.length / 2)];
  }

  return {
    diameterPixels: Math.round(finalOuter * 2),
    innerDiameterPixels: finalInner ? Math.round(finalInner * 2) : 0,
    center: { x: cx, y: cy },
    region: { xMin: cx - Math.round(finalOuter), xMax: cx + Math.round(finalOuter), yMin: cy - Math.round(finalOuter), yMax: cy + Math.round(finalOuter) }
  };
}

function drawCircle(buffer, center, radius, width, height, color) {
  const segments = 100;
  for (let i = 0; i < segments; i++) {
    const angle1 = (i / segments) * Math.PI * 2;
    const angle2 = ((i + 1) / segments) * Math.PI * 2;
    const x1 = Math.round(center.x + radius * Math.cos(angle1));
    const y1 = Math.round(center.y + radius * Math.sin(angle1));
    const x2 = Math.round(center.x + radius * Math.cos(angle2));
    const y2 = Math.round(center.y + radius * Math.sin(angle2));

    drawLine(buffer, x1, y1, x2, y2, width, height, color);
  }
}

function drawLine(buffer, x1, y1, x2, y2, width, height, color) {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = (x1 < x2) ? 1 : -1;
  const sy = (y1 < y2) ? 1 : -1;
  let err = dx - dy;

  while (true) {
    if (x1 >= 0 && x1 < width && y1 >= 0 && y1 < height) {
      const idx = (y1 * width + x1) * 3;
      buffer[idx] = color[0];
      buffer[idx + 1] = color[1];
      buffer[idx + 2] = color[2];
    }
    if (x1 === x2 && y1 === y2) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x1 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y1 += sy;
    }
  }
}

function drawOutline(buffer, cluster, width, height) {
  const clusterSet = new Set(cluster);
  for (const idx of cluster) {
    const x = idx % width;
    const y = Math.floor(idx / width);

    // Check if it's an edge pixel of the cluster
    let isEdge = false;
    const neighbors = [[x+1, y], [x-1, y], [x, y+1], [x, y-1]];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height || !clusterSet.has(ny * width + nx)) {
        isEdge = true;
        break;
      }
    }

    if (isEdge) {
      buffer[idx * 3] = 0;
      buffer[idx * 3 + 1] = 255;
      buffer[idx * 3 + 2] = 0; // Green outline
    }
  }
}

function calculateMedian(data, region = null, width = 0) {
  // Simple median: sort and pick middle. For performance on large arrays, use a histogram.
  const hist = new Int32Array(256);
  let totalCount = 0;
  if (region) {
    for (let y = region.yMin; y <= region.yMax; y++) {
      for (let x = region.xMin; x <= region.xMax; x++) {
        hist[data[y * width + x]]++;
        totalCount++;
      }
    }
  } else {
    for (let i = 0; i < data.length; i++) {
      hist[data[i]]++;
      totalCount++;
    }
  }

  let count = 0;
  const mid = totalCount / 2;
  for (let i = 0; i < 256; i++) {
    count += hist[i];
    if (count >= mid) return i;
  }
  return 128;
}

function breakClump(cluster, startIdx, data, width, height, median, options) {
  const {
    referenceThreshold = 0.4,
    maxCost = 0.35,
    nsmooth = 3,
    maxClusterAxisPx = 100
  } = options;

  const start_x = startIdx % width;
  const start_y = Math.floor(startIdx / width);
  const start_z = data[startIdx];

  // Sort cluster by distance to start point
  cluster.sort((a, b) => {
    const da = (a % width - start_x) ** 2 + (Math.floor(a / width) - start_y) ** 2;
    const db = (b % width - start_x) ** 2 + (Math.floor(b / width) - start_y) ** 2;
    return da - db;
  });

  const filteredCluster = [startIdx];
  const costs = cluster.map(idx => (data[idx] - start_z) ** 2 / (median ** 2));
  const clusterToIndex = new Map(cluster.map((idx, i) => [idx, i]));

  for (let i = 0; i < cluster.length; i++) {
    const idx = cluster[i];
    if (idx === startIdx) continue;

    // Fast distance check to match Python
    const d2_to_start = (idx % width - start_x) ** 2 + (Math.floor(idx / width) - start_y) ** 2;
    if (d2_to_start > maxClusterAxisPx ** 2) continue;

    // Find nearest dark pixel already in filtered cluster
    let nearestDarkIdx = -1;
    let minDist2 = Infinity;
    const darkThreshold = (median - start_z) * referenceThreshold + start_z;

    for (const fIdx of filteredCluster) {
      if (data[fIdx] <= darkThreshold) {
        const d2 = (idx % width - fIdx % width) ** 2 + (Math.floor(idx / width) - Math.floor(fIdx / width)) ** 2;
        if (d2 < minDist2) {
          minDist2 = d2;
          nearestDarkIdx = fIdx;
        }
      }
    }

    if (nearestDarkIdx === -1) continue;
    if (idx === nearestDarkIdx) {
      filteredCluster.push(idx);
      continue;
    }

    // Path check logic
    const x1 = idx % width;
    const y1 = Math.floor(idx / width);
    const x2 = nearestDarkIdx % width;
    const y2 = Math.floor(nearestDarkIdx / width);

    const path = getPathIndices(x1, y1, x2, y2, width, height, new Set(cluster));
    if (!path) continue;

    const pathCosts = path.map(pIdx => costs[clusterToIndex.get(pIdx)]);
    const maxPathCost = getMaxSmoothedCost(pathCosts, nsmooth);

    if (maxPathCost < maxCost) {
      filteredCluster.push(idx);
    }
  }

  return filteredCluster;
}

function getPathIndices(x1, y1, x2, y2, width, height, clusterSet) {
  const path = [];
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = (x1 < x2) ? 1 : -1;
  const sy = (y1 < y2) ? 1 : -1;
  let err = dx - dy;

  let currX = x1;
  let currY = y1;

  while (true) {
    const idx = currY * width + currX;
    if (!clusterSet.has(idx)) return null; // Path broken
    path.push(idx);

    if (currX === x2 && currY === y2) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      currX += sx;
    }
    if (e2 < dx) {
      err += dx;
      currY += sy;
    }
  }
  return path;
}

function getMaxSmoothedCost(costs, windowSize) {
  if (costs.length === 0) return 0;
  if (windowSize >= costs.length) {
    return (costs.reduce((a, b) => a + b, 0) / costs.length) * windowSize;
  }

  let maxVal = 0;
  for (let i = 0; i < costs.length; i++) {
    let sum = 0;
    let count = 0;
    const half = Math.floor(windowSize / 2);
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < costs.length) {
        sum += costs[j];
        count++;
      }
    }
    const val = sum * (windowSize / count);
    if (val > maxVal) maxVal = val;
  }
  return maxVal;
}

function calculateClusterMetrics(indices, width, height, data, median, pixelScale) {
  // Centroid and minZ
  let sumX = 0, sumY = 0;
  let minZ = 255;
  for (const idx of indices) {
    const x = idx % width;
    const y = Math.floor(idx / width);
    sumX += x;
    sumY += y;
    if (data[idx] < minZ) minZ = data[idx];
  }

  const count = indices.length || 1;
  const xMean = sumX / count;
  const yMean = sumY / count;

  // Surface multiplier: dark pixels contribute more
  const surfaceMultiplier = Math.max((median - minZ) / median, 1.0);
  const surfacePx = indices.length * surfaceMultiplier;

  // Long axis = max distance from centroid
  let maxD2 = 0;
  for (const idx of indices) {
    const x = idx % width;
    const y = Math.floor(idx / width);
    const d2 = (x - xMean) ** 2 + (y - yMean) ** 2;
    if (d2 > maxD2) maxD2 = d2;
  }
  const longAxisPx = Math.sqrt(maxD2) || 1e-4;

  // Roundness and short axis
  const roundness = surfacePx === 1 ? 1 : surfacePx / (Math.PI * (longAxisPx ** 2));
  const shortAxisPx = surfacePx / (Math.PI * longAxisPx);
  const volumePx = Math.PI * (shortAxisPx ** 2) * longAxisPx;

  // Convert to mm
  const effectivePixelScale = pixelScale || 22.65;
  const surfaceMm2 = surfacePx / (effectivePixelScale ** 2);
  const longAxisMm = longAxisPx / effectivePixelScale;
  const shortAxisMm = shortAxisPx / effectivePixelScale;
  const volumeMm3 = volumePx / (effectivePixelScale ** 3);
  const diameterMm = 2 * Math.sqrt(longAxisMm * shortAxisMm);

  return {
    surfacePx,
    xMean,
    yMean,
    longAxisPx,
    shortAxisPx,
    roundness,
    volumePx,
    pixelCount: indices.length,
    surfaceMm2,
    longAxisMm,
    shortAxisMm,
    volumeMm3,
    diameterMm
  };
}
