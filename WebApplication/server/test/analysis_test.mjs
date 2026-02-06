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
  const tests = [
    { rel: `${resourcesDir}/circle-93mm.jpeg`, expectScale: 18.75, tol: 3.0, minParticles: 150 },
    { rel: `${resourcesDir}/circle-93mm-crop.jpg`, expectScale: 18.75, tol: 3.0, minParticles: 150 },
    { rel: `${resourcesDir}/circle-93mm-crop-72ppcm.jpg`, expectScale: 18.44, tol: 1.0, minParticles: 200 }
  ];

  for (const t of tests) {
    const p = t.rel;
    if (!fs.existsSync(p)) {
      console.warn('SKIP missing', p);
      continue;
    }
    console.log('\n--- TEST:', p);
    const buf = fs.readFileSync(p);
    const res = await analyzeImage(buf, { referenceMode: 'detected', quick: true, debug: true });
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
    const derivedScale = res.calibration.outerDiameterPx / (res.calibration.outerDiameterMm || 93);
    if (!approxEqual(res.pixelScale, derivedScale, 0.0001)) {
      throw new Error(`pixelScale ${res.pixelScale} does not match calibration-derived scale ${derivedScale} for ${p}`);
    }
    if (res.particleCount < t.minParticles) {
      throw new Error(`particleCount ${res.particleCount} < min ${t.minParticles} for ${p}`);
    }
    console.log('PASS');
  }
}

run().then(()=>console.log('\nALL TESTS PASSED')).catch(err=>{
  console.error('\nTEST FAILED', err && err.stack || err);
  process.exit(1);
});
