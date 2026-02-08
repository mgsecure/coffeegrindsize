import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeImage } from '../src/util/analysis.js';

async function runOne(buf, opts, label, outDir) {
  const res = await analyzeImage(buf, opts);
  console.log(`${label} -> pixelScale:`, res.pixelScale, 'particleCount:', res.particleCount);
  console.log(`${label} -> calibration:`, res.calibration);
  const thresholdBuf = Buffer.from(res.thresholdImage.split(',')[1], 'base64');
  const outlinesBuf = Buffer.from(res.outlinesImage.split(',')[1], 'base64');
  await fs.writeFile(path.join(outDir, `${label}_threshold.png`), thresholdBuf);
  await fs.writeFile(path.join(outDir, `${label}_outlines.png`), outlinesBuf);
}

async function run() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const samplePath = path.join(__dirname, '..', '..', 'client', 'src', 'resources', 'circle-93mm.jpg');

  try {
    const buf = await fs.readFile(samplePath);
    const outDir = path.join(__dirname, '..', 'test', 'out');
    await fs.mkdir(outDir, { recursive: true });

    // Run default (auto) mode
    await runOne(buf, { quick: true, referenceMode: 'auto' }, 'auto', outDir);
    // Run detected-only mode
    await runOne(buf, { quick: true, referenceMode: 'detected' }, 'detected', outDir);

    console.log('Wrote outputs to', outDir);
  } catch (err) {
    console.error('Error running smoke test:', err);
    process.exit(1);
  }
}

run();
