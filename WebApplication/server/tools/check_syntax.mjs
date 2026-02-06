import fs from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, 'src');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const d of list) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) results = results.concat(walk(p));
    else if (d.isFile() && p.endsWith('.js')) results.push(p);
  }
  return results;
}

(async () => {
  const files = walk(root);
  let ok = true;
  for (const f of files) {
    try {
      // dynamic import to allow ESM parsing
      await import(pathToFileURL(f).href + `?t=${Date.now()}`);
      console.log('OK:', f);
    } catch (e) {
      ok = false;
      console.error('SYNTAX/LOAD ERROR in', f);
      console.error(e && e.stack ? e.stack : e);
    }
  }
  if (!ok) process.exit(2);
  console.log('\nAll files parsed successfully');
})();
