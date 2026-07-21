import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { decodeVTF } from '../shared/vtf.js';
import { encodePNG } from '../shared/png.js';

const sources = process.argv.slice(2);
if (!sources.length) sources.push('C:/Users/jakub/Desktop/mvm stuff/wavebargen/materials');
const outDir = 'C:/Users/jakub/Desktop/mvm stuff/popfile-visualizer/icons';
mkdirSync(outDir, { recursive: true });

let ok = 0, fail = 0;
const manifest = [];

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    const lower = e.name.toLowerCase();
    if (!lower.startsWith('leaderboard_class_')) continue;
    const name = basename(lower).replace(/\.(vtf|png)$/, '');
    if (manifest.includes(name)) continue;
    try {
      if (lower.endsWith('.vtf')) {
        const { width, height, rgba } = decodeVTF(readFileSync(full));
        writeFileSync(join(outDir, name + '.png'), encodePNG(rgba, width, height));
      } else if (lower.endsWith('.png')) {
        writeFileSync(join(outDir, name + '.png'), readFileSync(full));
      } else continue;
      manifest.push(name);
      ok++;
    } catch (err) {
      fail++;
      console.log(`FAIL ${e.name}: ${err.message}`);
    }
  }
}

for (const s of sources) walk(s);
manifest.sort();
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`${ok} converted, ${fail} failed → ${outDir}`);
