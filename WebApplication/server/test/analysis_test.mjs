import fs from 'fs';
import { analyzeImage } from '../src/util/analysis.js';

function approxEqual(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

async function run() {
  const tests = [
    { rel: '../../client/src/resources/circle-93mm.jpeg', expectScale: 18.75, tol: 0.6, minParticles: 300 },
    { rel: '../../client/src/resources/circle-93mm-crop-72ppcm.jpg', expectScale: 18.44, tol: 0.8, minParticles: 200 }
  ];

  for (const t of tests) {
    const p = t.rel;
    if (!fs.existsSync(p)) {
      console.warn('SKIP missing', p);
      continue;
    }
    console.log('\n--- TEST:', p);
    const buf = fs.readFileSync(p);
    const res = await analyzeImage(buf, { referenceMode: 'auto', quick: true, debug: false });
    console.log('pixelScale=', res.pixelScale, ' particleCount=', res.particleCount);
    if (!res.pixelScale || !approxEqual(res.pixelScale, t.expectScale, t.tol)) {
      throw new Error(`pixelScale ${res.pixelScale} not within ${t.tol} of ${t.expectScale} for ${p}`);
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
