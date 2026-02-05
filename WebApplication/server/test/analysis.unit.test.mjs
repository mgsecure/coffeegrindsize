import sharp from 'sharp';
import assert from 'assert';
import { analyzeImage } from '../src/util/analysis.js';

// Helper: create an RGB image as a Buffer with a dark annulus and two small dark blobs
async function createAnnulusImage({width=800, height=800, centerX=400, centerY=400, outerRadius=350, innerRadius=320}) {
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels, 255); // white background

  const setPixel = (x, y, r, g, b) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = (y * width + x) * channels;
    raw[idx] = r;
    raw[idx + 1] = g;
    raw[idx + 2] = b;
  };

  // Draw thin annulus outlines (outer and inner circle outlines) — make them dark so detectReferenceCircle finds them
  const drawCircleOutline = (radius, thickness = 2) => {
    const segments = Math.max(360, Math.round(2 * Math.PI * radius / 1));
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const cx = Math.round(centerX + radius * Math.cos(angle));
      const cy = Math.round(centerY + radius * Math.sin(angle));
      for (let ty = -thickness; ty <= thickness; ty++) {
        for (let tx = -thickness; tx <= thickness; tx++) {
          setPixel(cx + tx, cy + ty, 0, 0, 0);
        }
      }
    }
  };

  drawCircleOutline(outerRadius, 2);
  drawCircleOutline(innerRadius, 2);

  // Draw small particle fully inside annulus (should be counted)
  const p1x = centerX + Math.round(innerRadius - 20); // well inside inner circle
  const p1y = centerY;
  for (let yy = -6; yy <= 6; yy++) {
    for (let xx = -6; xx <= 6; xx++) {
      if (xx*xx + yy*yy <= 36) setPixel(p1x + xx, p1y + yy, 0, 0, 0);
    }
  }

  // Draw small particle touching inner boundary (should be excluded)
  const p2x = centerX + Math.round(innerRadius - 3); // intentionally touching/overlapping inner boundary
  const p2y = centerY;
  for (let yy = -6; yy <= 6; yy++) {
    for (let xx = -6; xx <= 6; xx++) {
      if (xx*xx + yy*yy <= 36) setPixel(p2x + xx, p2y + yy, 0, 0, 0);
    }
  }

  // Convert raw RGB to PNG buffer using sharp
  const png = await sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
  return png;
}

async function testAnnulusInclusion() {
  console.log('Running testAnnulusInclusion...');
  const imgBuf = await createAnnulusImage({});
  // Use fixed mode with expected diameters matching the synthetic annulus to avoid ring pixels being interpreted as particles
  const res = await analyzeImage(imgBuf, { quick: true, referenceMode: 'fixed', expectedOuterDiameterPx: 700, expectedInnerDiameterPx: 640, outerDiameterMm: 93 });

  console.log('Calibration:', res.calibration);
  console.log('thresholdValue:', res.thresholdValue, 'pixelScale:', res.pixelScale);
  console.log('particles:', JSON.stringify(res.particles, null, 2));
  console.log('ParticleCount:', res.particleCount);

  // Expect exactly 1 particle counted (the fully interior one)
  assert.strictEqual(res.particleCount, 1, 'Expected 1 particle fully inside annulus to be counted');
  console.log('testAnnulusInclusion passed');
}

async function testDetectedVsFixedScale() {
  console.log('Running testDetectedVsFixedScale...');
  const imgBuf = await createAnnulusImage({});
  const resDetected = await analyzeImage(imgBuf, { quick: true, referenceMode: 'detected' });
  const resFixed = await analyzeImage(imgBuf, { quick: true, referenceMode: 'fixed', expectedOuterDiameterPx: 700, expectedInnerDiameterPx: 640, outerDiameterMm: 93 });

  console.log('detected.scale=', resDetected.pixelScale);
  console.log('fixed.scale=', resFixed.pixelScale);

  assert.ok(Math.abs(resDetected.pixelScale - (resDetected.calibration.outerDiameterPx / resDetected.calibration.outerDiameterMm)) < 1e-6, 'Detected pixelScale should be derived from detected outer diameter');
  assert.ok(Math.abs(resFixed.pixelScale - (700 / 93)) < 1e-6, 'Fixed pixelScale should be derived from expectedOuterDiameterPx');
  console.log('testDetectedVsFixedScale passed');
}

async function runAll() {
  try {
    await testAnnulusInclusion();
    await testDetectedVsFixedScale();
    console.log('ALL TESTS PASSED');
    process.exit(0);
  } catch (err) {
    console.error('TEST FAILED:', err);
    process.exit(1);
  }
}

runAll();
