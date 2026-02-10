import fs from 'fs';
import { analyzeImage } from '../src/util/analysis.js';

import path from 'path'
import {fileURLToPath} from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const resourcesDir = path.join(__dirname, '/../../client/src/resources')

function approxEqual(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

async function run() {
  const start = Date.now()

  const tests = [
    // Standard test with 'detected' mode (actual pixel scale for this specific file is ~16.84)
    //{ rel: `${resourcesDir}/circle-93mm.jpg`, mode: 'detected', expectScale: 16.84, tol: 0.1, minParticles: 200 },
    // Matching the configuration that yields 18.624 pix/mm as reported by user
    //{ rel: `${resourcesDir}/circle-93mm.jpg`, mode: 'fixed', expectScale: 18.624, tol: 0.01, minParticles: 200 },
    //{ rel: `${resourcesDir}/circle-93mm-crop.jpg`, mode: 'detected', expectScale: 16.82, tol: 0.1, minParticles: 200 },
    //{ rel: `${resourcesDir}/circle-93mm-crop-72ppcm.jpg`, mode: 'detected', expectScale: 12.08, tol: 0.1, minParticles: 200 }
    //{ rel: `${resourcesDir}/4-drop-flash-contrast.jpg`, mode: 'detected', expectScale: 12.82, tol: 0.1, minParticles: 200 },
    //{ rel: `${resourcesDir}/4-drop-flash.jpeg`, mode: 'detected', expectScale: 12.82, tol: 0.1, minParticles: 200, options: { contrast: 1.5 } },
    { rel: `${resourcesDir}/M47-1.0.0-closer-ps.png`, mode: 'detected', expectScale: 13.59, tol: 0.1, minParticles: 200 },
  ];

  for (const t of tests) {
    const p = t.rel;
    if (!fs.existsSync(p)) {
      console.warn('SKIP missing', p);
      continue;
    }
    console.log(`\n--- TEST: ${p} (mode: ${t.mode})`);
    const buf = fs.readFileSync(p);
    const res = await analyzeImage(buf, { referenceMode: t.mode, quick: true, debug: true, ...t.options });
    console.log('pixelScale=', res.pixelScale, ' particleCount=', res.particleCount);
    if (res.debug) {
      console.log('debug:', JSON.stringify(res.debug, null, 2));
    }
    if (res.calibration) {
      console.log('calibration:', JSON.stringify(res.calibration, null, 2));
    }
    // Verify pixelScale is consistent with the chosen outerDiameterPx (detected or fallback)
    if (!res.pixelScale || !res.calibration || !res.calibration.outerDiameterPx) {
      throw new Error(`pixelScale or calibration missing for ${p}`);
    }
    if (!approxEqual(res.pixelScale, t.expectScale, t.tol)) {
      throw new Error(`pixelScale ${res.pixelScale} deviates from expected ${t.expectScale} (tol ${t.tol}) for ${p}`);
    }
    const derivedScale = res.calibration.outerDiameterPx / (res.calibration.outerDiameterMm || 93);
    if (!approxEqual(res.pixelScale, derivedScale, 0.0001)) {
      throw new Error(`pixelScale ${res.pixelScale} does not match calibration-derived scale ${derivedScale} for ${p}`);
    }
    if (res.particleCount < t.minParticles) {
      throw new Error(`particleCount ${res.particleCount} < min ${t.minParticles} for ${p}`);
    }
    console.log('PASS');
    console.log('Done', res.particleCount, 'particles, time:', Date.now() - start, 'ms')
  }
}

run().then(()=>console.log('\nALL TESTS PASSED')).catch(err=>{
  console.error('\nTEST FAILED', err && err.stack || err);
  process.exit(1);
});
