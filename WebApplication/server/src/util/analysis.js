import sharp from 'sharp';
import { logger } from '../logger/logger.js';

// Calculate cluster metrics used during segmentation. Defined early so analyzeImage can call it.
function calculateClusterMetrics(indices, width, height, data, median, pixelScale) {
  // Compute centroid and minimum intensity (darkest pixel)
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

  // Surface measure: weight by darkness relative to median
  const surfaceMultiplier = Math.max((median - minZ) / Math.max(1, median), 1.0);
  const surfacePx = indices.length * surfaceMultiplier;

  // Long axis: max distance from centroid
  let maxD2 = 0;
  for (const idx of indices) {
    const x = idx % width;
    const y = Math.floor(idx / width);
    const d2 = (x - xMean) ** 2 + (y - yMean) ** 2;
    if (d2 > maxD2) maxD2 = d2;
  }
  // Use a small constant to account for pixel extent; 
  // at lower resolutions, a single pixel represents a larger physical area.
  const longAxisPx = Math.sqrt(maxD2) + 0.25; 

  // Short axis estimated from surface area assuming elliptical shape: area = pi * a * b
  const shortAxisPx = surfacePx / (Math.PI * longAxisPx) || 1e-4;

  // Roundness measure (surface relative to circle of radius longAxis)
  const roundness = surfacePx === 1 ? 1 : surfacePx / (Math.PI * (longAxisPx ** 2));

  // Volume proxy (ellipsoid-like)
  const volumePx = Math.PI * (shortAxisPx ** 2) * longAxisPx;

  // Convert to mm units
  const effectivePixelScale = pixelScale || 22.65; // px per mm fallback
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
      brightness = 1.0,
      contrast = 1.0,
      maxClusterAxis = 5,
      minSurface = 0.01,
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
      expectedOuterDiameterPx = 2307, // outside diameter in pixels (default measured target)
      expectedInnerDiameterPx = 2166, // inside diameter in pixels (169mm at 12.82 pix/mm)
      outerDiameterMm = 180, // physical outer diameter in mm
      diameterTolerancePx = 10, // tolerance to decide whether to trust detected diameter
      edgeTolerancePx = 1.5, // pixels near inner/outer boundaries considered "edge"
      // referenceMode: 'auto' | 'fixed' | 'detected'
      // 'auto' = prefer detected if close to expected, otherwise use expected
      // 'fixed' = always use expected diameters
      // 'detected' = always use detected diameter (fall back to expected if detection fails)
      // default to detected to prefer measured values from each image
      referenceMode = 'detected',
    } = options;

    const useQuick = quick === true || quick === 'true' || quick === 1 || quick === '1';
    const useDebug = debug === true || debug === 'true' || debug === 1 || debug === '1';

    logger.info({ threshold, quick: useQuick, maxClusterAxis, minSurface, maxSurface, minRoundness, referenceMode, brightness, contrast, debug: useDebug }, 'analyzeImage options in effect');

    // 1. Load image and get blue channel
    let image = sharp(buffer);

    // Apply brightness/contrast if specified
    if (brightness !== 1.0 || contrast !== 1.0) {
      // sharp .modulate({ brightness: factor }) uses 1.0 as identity
      // sharp .linear(multiplier, offset) can be used for contrast
      // contrast = 1.0 is identity. 
      // y = contrast * x + offset
      // To keep mean/midpoint: y = contrast * (x - 128) + 128 * brightness
      if (brightness !== 1.0) {
        image = image.modulate({ brightness });
      }
      if (contrast !== 1.0) {
        image = image.linear(contrast, -(128 * contrast) + 128);
      }
    }

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

    // 1.1 Detect 93mm circle / annulus for pixel scale
    let medianInitial = calculateMedian(data);

    let circleInfo = null;
    let detectorUsed = null;
    let usedDetectorDetail = null;
    let fallbackUsed = false;

    // Use box detector first to get candidate center
    const boxCircle = detectReferenceCircle(data, width, height, medianInitial);
    const initialCenter = boxCircle ? boxCircle.center : { x: width / 2, y: height / 2 };

    // Primary Pure JS Detector: Iterative Radial Gradient
    circleInfo = detectAnnulusIterative(data, width, height, medianInitial, initialCenter, {
      expectedOuterDiameterPx,
      expectedInnerDiameterPx,
      minDetectedOuterFraction,
      minOuterImgFraction,
      debug: useDebug
    });

    if (circleInfo) {
      detectorUsed = 'js_radial';
      usedDetectorDetail = 'iterative radial gradient (JS)';
    }

    // If detectAnnulusIterative failed, try remaining fallbacks.
    if (!circleInfo) {
      const preferCenter = boxCircle ? boxCircle.center : null;
      const radial = detectAnnulusByRadialProfile(data, width, height, medianInitial, preferCenter, { expectedOuterDiameterPx, minDetectedOuterFraction, minOuterImgFraction, debug: useDebug });
      if (radial) {
        circleInfo = radial;
        detectorUsed = 'radial';
        usedDetectorDetail = 'radial';
      }
    }

    // If radial-profile detection yields a very small diameter (likely a false positive), try radial-average fallback
    if (circleInfo && typeof circleInfo.diameterPixels === 'number') {
      const minByExpected = expectedOuterDiameterPx * minDetectedOuterFraction;
      const minByImage = Math.min(width, height) * minOuterImgFraction;
      const minAllowed = Math.max(1, Math.round(Math.max(minByExpected, minByImage)));
      if (circleInfo.diameterPixels < minAllowed) {
        const avg = detectAnnulusByRadialProfileAvg(data, width, height, medianInitial, circleInfo.center || (boxCircle && boxCircle.center) || null, { expectedOuterDiameterPx, minDetectedOuterFraction, minOuterImgFraction, debug: useDebug });
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
      usedDetectorDetail = usedDetectorDetail || 'box';
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

    logger.info({ calibration: { measuredOuterPx, outerDiameterPx, innerDiameterPx, outerDiameterMm, pixelScale, referenceMode }, detector: usedDetectorDetail }, 'Calibration chosen');

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

    // Apply a simple noise filter: remove isolated thresholded pixels
    // Use the raw mask directly to avoid extra sortedIndices pass if not needed yet
    const denoisedMask = new Uint8Array(mask.length);
    for (let i = 0; i < thresholdedIndices.length; i++) {
      const idx = thresholdedIndices[i];
      const x = idx % width;
      const y = (idx / width) | 0;
      let neighborsCount = 0;
      if (x > 0 && mask[idx - 1]) neighborsCount++;
      if (x < width - 1 && mask[idx + 1]) neighborsCount++;
      if (y > 0 && mask[idx - width]) neighborsCount++;
      if (y < height - 1 && mask[idx + width]) neighborsCount++;
      if (neighborsCount >= 1) {
        denoisedMask[idx] = 1;
      }
    }

    // Counting sort thresholded indices by brightness (0-255) to match Python (darkest first)
    // Only sort the DENOISED thresholded pixels to reduce work
    const denoisedThresholdedIndices = [];
    for (let i = 0; i < thresholdedIndices.length; i++) {
      if (denoisedMask[thresholdedIndices[i]]) {
        denoisedThresholdedIndices.push(thresholdedIndices[i]);
      }
    }

    const counts = new Uint32Array(256);
    for (let i = 0; i < denoisedThresholdedIndices.length; i++) {
      counts[data[denoisedThresholdedIndices[i]]]++;
    }
    const offsets = new Uint32Array(256);
    for (let i = 1; i < 256; i++) {
      offsets[i] = offsets[i - 1] + counts[i - 1];
    }
    const sortedIndices = new Uint32Array(denoisedThresholdedIndices.length);
    for (let i = 0; i < denoisedThresholdedIndices.length; i++) {
      const idx = denoisedThresholdedIndices[i];
      sortedIndices[offsets[data[idx]]++] = idx;
    }

    for (let i = 0; i < sortedIndices.length; i++) {
      const index = sortedIndices[i];
      if (visited[index]) continue;

      let cluster = [];
      let queue = [index];
      let head = 0;
      visited[index] = 1;
      let isOnEdge = false;

      const sX = index % width;
      const sY = (index / width) | 0;

      // Segmentation BFS
      while (head < queue.length) {
        const curr = queue[head++];
        cluster.push(curr);
        if (edgePixels.has(curr)) isOnEdge = true;

        const x = curr % width;
        const y = (curr / width) | 0;

        // Inline 4-neighbors check
        if (x + 1 < width) {
          const nIdx = curr + 1;
          if (denoisedMask[nIdx] && !visited[nIdx]) {
            const dx = (x + 1) - sX;
            const dy = y - sY;
            if (dx * dx + dy * dy <= maxClusterAxisPx ** 2) {
              visited[nIdx] = 1;
              queue.push(nIdx);
            }
          }
        }
        if (x - 1 >= 0) {
          const nIdx = curr - 1;
          if (denoisedMask[nIdx] && !visited[nIdx]) {
            const dx = (x - 1) - sX;
            const dy = y - sY;
            if (dx * dx + dy * dy <= maxClusterAxisPx ** 2) {
              visited[nIdx] = 1;
              queue.push(nIdx);
            }
          }
        }
        if (y + 1 < height) {
          const nIdx = curr + width;
          if (denoisedMask[nIdx] && !visited[nIdx]) {
            const dx = x - sX;
            const dy = (y + 1) - sY;
            if (dx * dx + dy * dy <= maxClusterAxisPx ** 2) {
              visited[nIdx] = 1;
              queue.push(nIdx);
            }
          }
        }
        if (y - 1 >= 0) {
          const nIdx = curr - width;
          if (denoisedMask[nIdx] && !visited[nIdx]) {
            const dx = x - sX;
            const dy = (y - 1) - sY;
            if (dx * dx + dy * dy <= maxClusterAxisPx ** 2) {
              visited[nIdx] = 1;
              queue.push(nIdx);
            }
          }
        }
      }

      if (!useQuick && cluster.length > 1) {
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
          clusters.push({ ...metrics, pixels: cluster });
        }
      }
    }

    // Draw circle detection for feedback
    const thresholdImageBuffer = new Uint8Array(width * height * 3);
    const outlinesImageBuffer = new Uint8Array(width * height * 3);

    for (let i = 0; i < data.length; i++) {
      const val = data[i];
      const i3 = i * 3;
      thresholdImageBuffer[i3] = val;
      thresholdImageBuffer[i3 + 1] = val;
      thresholdImageBuffer[i3 + 2] = val;
      outlinesImageBuffer[i3] = val;
      outlinesImageBuffer[i3 + 1] = val;
      outlinesImageBuffer[i3 + 2] = val;
    }

    // Mark ALL thresholded pixels red in threshold image at once
    for (let i = 0; i < thresholdedIndices.length; i++) {
      const i3 = thresholdedIndices[i] * 3;
      thresholdImageBuffer[i3] = 255;
      thresholdImageBuffer[i3 + 1] = 0;
      thresholdImageBuffer[i3 + 2] = 0;
    }

    // Draw outlines for valid clusters
    for (let i = 0; i < clusters.length; i++) {
      drawOutline(outlinesImageBuffer, clusters[i].pixels, width, height);
    }

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

    // Compute summary statistics (D10/D50/D90, mode, mean, stdDev) on particle diameters (mm) and surfaces (mm2)
    let statistics = null;
    if (clusters.length > 0) {
      const computeStats = (vals) => {
        const sorted = vals.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
        const n = sorted.length;
        if (n === 0) return null;

        const quantile = (arr, q) => {
          const pos = (arr.length - 1) * q;
          const lower = Math.floor(pos);
          const upper = Math.ceil(pos);
          if (lower === upper) return arr[lower];
          const weight = pos - lower;
          return arr[lower] * (1 - weight) + arr[upper] * weight;
        };

        const q10 = quantile(sorted, 0.10);
        const q50 = quantile(sorted, 0.50);
        const q90 = quantile(sorted, 0.90);

        const mean = sorted.reduce((s, v) => s + v, 0) / n;
        const variance = n > 1 ? sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
        const stdDev = Math.sqrt(variance);

        const bins = Math.min(100, Math.max(10, Math.round(Math.sqrt(n))));
        const minVal = sorted[0];
        const maxVal = sorted[sorted.length - 1];
        const binCounts = new Array(bins).fill(0);
        const binWidth = (maxVal - minVal) / bins || 1;
        for (const v of sorted) {
          const idx = Math.min(bins - 1, Math.floor((v - minVal) / binWidth));
          binCounts[idx]++;
        }
        let maxIdx = 0;
        for (let i = 1; i < bins; i++) if (binCounts[i] > binCounts[maxIdx]) maxIdx = i;
        const mode = minVal + (maxIdx + 0.5) * binWidth;

        return {
          mean,
          stdDev,
          mode,
          p10: q10,
          p50: q50,
          p90: q90,
          // Legacy aliases for diameter
          D10: q10,
          D50: q50,
          D90: q90
        };
      };

      const diameterStats = computeStats(clusters.map(p => p.diameterMm));
      const surfaceStats = computeStats(clusters.map(p => p.surfaceMm2));

      statistics = {
        count: clusters.length,
        diameter: diameterStats,
        surface: surfaceStats,
        // Legacy flat structure for backward compatibility
        ...diameterStats
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
      debug: useDebug ? {
        totalThresholded,
        thresholdedInsideInner,
        analysisRegion,
        measuredOuterPx,
        measuredInnerPx,
        usedInnerDiameterPx: innerDiameterPx,
        usedOuterDiameterPx: outerDiameterPx,
        fallbackUsed: initialFallbackUsed,
        detectorUsed: usedDetector,
        detectorDetail: usedDetectorDetail,
        center: circleCenter,
       } : undefined,
    };

    // If debug is enabled, write a debug JSON to /tmp so the runner can pick it up even if stdout is suppressed
    if (useDebug) {
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
      let head = 0;
      visited[i] = 1;
      let minX = i % width, maxX = i % width, minY = Math.floor(i / width), maxY = Math.floor(i / width);

      while (head < queue.length) {
        const curr = queue[head++];
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
  // Use a local bitmask for the cluster to avoid creating a Set
  // Find cluster bounding box
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (const idx of cluster) {
    const x = idx % width;
    const y = Math.floor(idx / width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const clusterMask = new Uint8Array(w * h);
  for (const idx of cluster) {
    clusterMask[(Math.floor(idx / width) - minY) * w + (idx % width - minX)] = 1;
  }

  for (const idx of cluster) {
    const x = idx % width;
    const y = Math.floor(idx / width);

    let isEdge = false;
    const nxCoords = [x + 1, x - 1, x, x];
    const nyCoords = [y, y, y + 1, y - 1];

    for (let i = 0; i < 4; i++) {
      const nx = nxCoords[i];
      const ny = nyCoords[i];
      if (nx < minX || nx > maxX || ny < minY || ny > maxY || !clusterMask[(ny - minY) * w + (nx - minX)]) {
        isEdge = true;
        break;
      }
    }

    if (isEdge) {
      const i3 = idx * 3;
      buffer[i3] = 0;
      buffer[i3 + 1] = 255;
      buffer[i3 + 2] = 0;
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


function breakClump(cluster, seedIndex, data, width, height, median, opts = {}) {
  if (!cluster || cluster.length <= 1) return cluster;

  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (const idx of cluster) {
    const x = idx % width;
    const y = Math.floor(idx / width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  minX = Math.max(0, minX - 1);
  minY = Math.max(0, minY - 1);
  maxX = Math.min(width - 1, maxX + 1);
  maxY = Math.min(height - 1, maxY + 1);
  const wBox = maxX - minX + 1;
  const hBox = maxY - minY + 1;

  const mask = new Uint8Array(wBox * hBox);
  for (const idx of cluster) {
    mask[(Math.floor(idx / width) - minY) * wBox + (idx % width - minX)] = 1;
  }

  const maxIter = 20;
  let changed = true;
  let iter = 0;
  while (changed && iter < maxIter) {
    changed = false;
    iter++;
    const toRemove = [];
    for (let by = 0; by < hBox; by++) {
      const rowOffset = by * wBox;
      for (let bx = 0; bx < wBox; bx++) {
        const p = rowOffset + bx;
        if (!mask[p]) continue;
        let neigh = 0;
        if (bx > 0 && mask[p - 1]) neigh++;
        if (bx < wBox - 1 && mask[p + 1]) neigh++;
        if (by > 0 && mask[p - wBox]) neigh++;
        if (by < hBox - 1 && mask[p + wBox]) neigh++;
        if (neigh <= 1) toRemove.push(p);
      }
    }
    if (toRemove.length === 0) break;
    for (let i = 0; i < toRemove.length; i++) {
      mask[toRemove[i]] = 0;
      changed = true;
    }
  }

  const visited = new Uint8Array(wBox * hBox);
  const components = [];
  const seedBx = (seedIndex % width) - minX;
  const seedBy = Math.floor(seedIndex / width) - minY;
  const seedP = seedBy * wBox + seedBx;
  let chosenComp = null;

  for (let by = 0; by < hBox; by++) {
    const rowOffset = by * wBox;
    for (let bx = 0; bx < wBox; bx++) {
      const p = rowOffset + bx;
      if (!mask[p] || visited[p]) continue;

      const comp = [];
      const q = [p];
      let head = 0;
      let hasSeed = false;
      visited[p] = 1;

      while (head < q.length) {
        const cur = q[head++];
        comp.push(cur);
        if (cur === seedP) hasSeed = true;

        const cx = cur % wBox;
        const cy = Math.floor(cur / wBox);
        const neighbors = [cur - 1, cur + 1, cur - wBox, cur + wBox];
        const nxCoords = [cx - 1, cx + 1, cx, cx];
        const nyCoords = [cy, cy, cy - 1, cy + 1];

        for (let i = 0; i < 4; i++) {
          const nb = neighbors[i];
          if (nxCoords[i] >= 0 && nxCoords[i] < wBox && nyCoords[i] >= 0 && nyCoords[i] < hBox) {
            if (!visited[nb] && mask[nb]) {
              visited[nb] = 1;
              q.push(nb);
            }
          }
        }
      }
      if (hasSeed) chosenComp = comp;
      components.push(comp);
    }
  }

  if (components.length <= 1) return cluster;
  if (!chosenComp) chosenComp = components.sort((a, b) => b.length - a.length)[0];

  const out = [];
  for (let i = 0; i < chosenComp.length; i++) {
    const p = chosenComp[i];
    out.push((Math.floor(p / wBox) + minY) * width + (p % wBox + minX));
  }
  return out.length < Math.round(cluster.length * 0.25) ? cluster : out;
}

function detectAnnulusIterative(data, width, height, median, initialCenter, opts = {}) {
  const { expectedOuterDiameterPx = 1744, expectedInnerDiameterPx = 1500, minDetectedOuterFraction = 0.6, minOuterImgFraction = 0.1, debug = false } = opts;
  const useDebug = debug === true || debug === 'true' || debug === 1 || debug === '1';
  // Pure JS iterative radial detector for identifying the annulus.
  // 1. Samples rays from center to find edge points via gradient.
  // 2. Fits a circle to those points to refine center and radius.
  // 3. Repeats to converge.
  const expectedRadius = expectedOuterDiameterPx / 2;
  const minRadius = expectedRadius * minDetectedOuterFraction;
  const circleThreshold = (median * 40) / 100;

  let currentCenter = { ...initialCenter };
  let outerRadius = expectedRadius;
  let innerRadius = expectedRadius * (expectedInnerDiameterPx / expectedOuterDiameterPx);

  const maxIterations = 8;
  for (let iter = 0; iter < maxIterations; iter++) {
    const rays = 72; // every 5 degrees
    const outerPoints = [];
    const innerPoints = [];

    for (let i = 0; i < rays; i++) {
      const theta = (i * 5 * Math.PI) / 180;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);

      // Search for outer edge (strong positive gradient: Dark -> Light)
      // Search range: [expectedRadius * 0.5, expectedRadius * 1.5]
      let bestGrad = 0;
      let bestR = null;
      const searchStart = Math.max(10, Math.round(outerRadius * 0.7));
      const searchEnd = Math.min(Math.min(width, height) / 2, Math.round(outerRadius * 1.3));

      for (let r = searchStart; r < searchEnd; r++) {
        const x = Math.round(currentCenter.x + r * cos);
        const y = Math.round(currentCenter.y + r * sin);
        if (x < 1 || x >= width - 1 || y < 1 || y >= height - 1) break;

        const idx = y * width + x;
        // Radial gradient approximated by central difference along ray
        // (Next - Prev) along the direction of the ray
        const rNextX = Math.round(currentCenter.x + (r + 1) * cos);
        const rNextY = Math.round(currentCenter.y + (r + 1) * sin);
        const rPrevX = Math.round(currentCenter.x + (r - 1) * cos);
        const rPrevY = Math.round(currentCenter.y + (r - 1) * sin);

        if (rNextX < 0 || rNextX >= width || rNextY < 0 || rNextY >= height ||
            rPrevX < 0 || rPrevX >= width || rPrevY < 0 || rPrevY >= height) continue;

        const grad = data[rNextY * width + rNextX] - data[rPrevY * width + rPrevX];

        if (grad > bestGrad) {
          bestGrad = grad;
          bestR = r;
        }
      }

      if (bestR && bestGrad > 5) { // Threshold for "sharp enough" edge
        outerPoints.push({ x: currentCenter.x + bestR * cos, y: currentCenter.y + bestR * sin, r: bestR, grad: bestGrad });
      }

      // Search for inner edge (strong negative gradient inside outer edge: Light -> Dark)
      if (bestR) {
        let bestInnerGrad = 0;
        let bestInnerR = null;
        // Search for inner edge, preferring something close to outer edge
        for (let r = bestR - 1; r > Math.round(bestR * 0.5); r--) {
          const x = Math.round(currentCenter.x + r * cos);
          const y = Math.round(currentCenter.y + r * sin);
          if (x < 1 || x >= width - 1 || y < 1 || y >= height - 1) break;
          const rNextX = Math.round(currentCenter.x + (r + 1) * cos);
          const rNextY = Math.round(currentCenter.y + (r + 1) * sin);
          const rPrevX = Math.round(currentCenter.x + (r - 1) * cos);
          const rPrevY = Math.round(currentCenter.y + (r - 1) * sin);

          if (rNextX < 0 || rNextX >= width || rNextY < 0 || rNextY >= height ||
              rPrevX < 0 || rPrevX >= width || rPrevY < 0 || rPrevY >= height) continue;

          const grad = data[rNextY * width + rNextX] - data[rPrevY * width + rPrevX];
          if (grad < bestInnerGrad) {
            bestInnerGrad = grad;
            bestInnerR = r;
          }
          // If we found a strong enough negative gradient close to the outer edge, stop.
          // This helps avoid picking up inner shadows/circles as the annulus edge.
          if (grad < -30 && r > bestR * 0.8) break;
        }
        if (bestInnerR) innerPoints.push({ r: bestInnerR });
      }
    }

    if (outerPoints.length < 8) break;

    // Filter outliers based on distance from the FITTED circle of the PREVIOUS iteration (or initial radius)
    // This is more robust than just filtering by radial distance from current center if the center is biased.
    // However, on first iteration we have no choice.
    const filteredPoints = outerPoints.filter(p => {
       const dx = p.x - currentCenter.x;
       const dy = p.y - currentCenter.y;
       const d = Math.sqrt(dx*dx + dy*dy);
       return Math.abs(d - outerRadius) < Math.max(30, outerRadius * 0.15);
    });

    if (useDebug) {
      // console.log(`Iter ${iter}: center=(${currentCenter.x.toFixed(2)}, ${currentCenter.y.toFixed(2)}) radius=${outerRadius.toFixed(2)} points=${filteredPoints.length}/${outerPoints.length}`);
    }

    // algebraic circle fit
    // We want to minimize sum(( (x-xc)^2 + (y-yc)^2 - R^2 )^2)
    // Actually, for consistency and simplicity, let's just use the median R and mean center if distributed well.
    // But since it's failing, let's try a very robust approach: 
    // 1. Keep center fixed if drift is small, or only move it slightly.
    // 2. Use a better outlier rejection.

    // Algebraic circle fit (Kåsa's method)
    // Minimizes sum(( (x-xc)^2 + (y-yc)^2 - R^2 )^2)
    // Linear system: A * [xc, yc, (xc^2 + yc^2 - R^2)]' = B
    // Where A_i = [2*xi, 2*yi, -1], B_i = xi^2 + yi^2
    const N = filteredPoints.length;
    let sumXi = 0, sumYi = 0;
    for (const p of filteredPoints) {
      sumXi += p.x;
      sumYi += p.y;
    }

    const meanX = sumXi / N;
    const meanY = sumYi / N;

    let Mxx = 0, Myy = 0, Mxy = 0, Mxz = 0, Myz = 0;
    for (const p of filteredPoints) {
      const dx = p.x - meanX;
      const dy = p.y - meanY;
      const dz = dx * dx + dy * dy;
      Mxx += dx * dx;
      Myy += dy * dy;
      Mxy += dx * dy;
      Mxz += dx * dz;
      Myz += dy * dz;
    }

    const det = Mxx * Myy - Mxy * Mxy;
    let newCenter;
    if (Math.abs(det) > 1e-6) {
      const xc_rel = (Mxz * Myy - Myz * Mxy) / (2 * det);
      const yc_rel = (Myz * Mxx - Mxz * Mxy) / (2 * det);
      newCenter = { x: meanX + xc_rel, y: meanY + yc_rel };
    } else {
      newCenter = { x: meanX, y: meanY };
    }

    // Robustness check: if new center is very far from current center, it might be due to 
    // points being clustered on one side.
    const distToInitial = Math.sqrt((newCenter.x - initialCenter.x)**2 + (newCenter.y - initialCenter.y)**2);
    if (distToInitial > 150) { // arbitrary sanity check
       if (debug) console.log(`  Warning: Circle fit center too far (${distToInitial.toFixed(1)}px); using mean instead`);
       newCenter = { x: meanX, y: meanY };
    }

    // Limit center move to avoid divergence and add damping
    const maxMove = 10;
    const damping = 0.5; 
    let dx = newCenter.x - currentCenter.x;
    let dy = newCenter.y - currentCenter.y;
    const moveDist = Math.sqrt(dx * dx + dy * dy);
    
    if (moveDist > maxMove) {
       dx *= maxMove / moveDist;
       dy *= maxMove / moveDist;
    }
    
    newCenter.x = currentCenter.x + dx * damping;
    newCenter.y = currentCenter.y + dy * damping;

    let sumDists = 0;
    for (const p of filteredPoints) {
      const pdx = p.x - newCenter.x;
      const pdy = p.y - newCenter.y;
      sumDists += Math.sqrt(pdx * pdx + pdy * pdy);
    }
    const newOuterRadius = sumDists / filteredPoints.length;

    // Filter outliers using median radius
    innerPoints.sort((a,b) => a.r - b.r);
    const medInnerR = innerPoints.length > 0 ? innerPoints[Math.floor(innerPoints.length / 2)].r : outerRadius * (expectedInnerDiameterPx / expectedOuterDiameterPx);
    const filteredInnerPoints = innerPoints.filter(p => Math.abs(p.r - medInnerR) < Math.max(20, medInnerR * 0.1));

    // Inner radius logic
    const newInnerRadius = filteredInnerPoints.length > 4 ? filteredInnerPoints.reduce((s, p) => s + p.r, 0) / filteredInnerPoints.length : outerRadius * (expectedInnerDiameterPx / expectedOuterDiameterPx);

    // Update state for next iteration
    if (Math.abs(newCenter.x - currentCenter.x) < 1 && Math.abs(newCenter.y - currentCenter.y) < 1) {
      currentCenter = newCenter;
      outerRadius = newOuterRadius;
      innerRadius = newInnerRadius;
      break;
    }
    currentCenter = newCenter;
    outerRadius = newOuterRadius;
    innerRadius = newInnerRadius;
  }

  if (outerRadius < minRadius) return null;

  return {
    diameterPixels: outerRadius * 2,
    innerDiameterPixels: innerRadius * 2,
    center: currentCenter,
    region: {
      xMin: Math.round(currentCenter.x - outerRadius),
      xMax: Math.round(currentCenter.x + outerRadius),
      yMin: Math.round(currentCenter.y - outerRadius),
      yMax: Math.round(currentCenter.y + outerRadius)
    }
  };
}
