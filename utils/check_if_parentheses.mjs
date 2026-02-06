import fs from 'fs';
import path from 'path';

function walk(dir) {
  const results = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results.push(...walk(full));
    } else if (stat.isFile() && full.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

function checkFiles(root) {
  const files = walk(root);
  const bad = [];
  const pattern = /if\s+e2\s*<\s*dx\)/g;
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    if (pattern.test(txt)) bad.push(f);
  }
  return bad;
}

const repoRoot = path.join(process.cwd());
const bad = checkFiles(repoRoot);
if (bad.length === 0) {
  console.log('No broken "if e2 < dx)" patterns found');
  process.exit(0);
} else {
  console.error('Broken patterns found in files:');
  for (const b of bad) console.error('  ', b);
  process.exit(2);
}
