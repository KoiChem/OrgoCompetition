// Extracts OrgoRush master data (compounds / units / rivals / approved property
// questions / pairing banks) from the OrgoRush index.html into game/data.json.
// Usage: node scripts/extract-data.mjs [path-to-orgorush-index.html]
import {readFileSync, writeFileSync} from 'node:fs';
const path = process.argv[2] ?? new URL('../../refs/orgorush-live/index.html', import.meta.url).pathname;
const src = readFileSync(path, 'utf8');
function grabJson(marker) {
  const i = src.indexOf(marker);
  if (i < 0) throw new Error('not found: ' + marker);
  const j = src.indexOf(';\n', i);
  return JSON.parse(src.slice(i + marker.length, j));
}
const DATA = grabJson('const DATA = ');
const UNITS = grabJson('const UNITS = ');
const PAIR_BANK = grabJson('const PAIR_BANK = ');
const PAIR2_BANK = grabJson('const PAIR2_BANK = ');
const out = {
  compounds: DATA.compounds,
  rivals: DATA.rivals,
  pQuestions: DATA.pQuestions.filter(q => q.approved),
  units: UNITS.map(u => ({name: u.name, compoundIds: u.compoundIds})),
  pairBank: PAIR_BANK,
  pair2Bank: PAIR2_BANK,
};
writeFileSync(new URL('../game/data.json', import.meta.url), JSON.stringify(out));
console.log(`compounds=${out.compounds.length} units=${out.units.length} rivals=${out.rivals.length} pQuestions=${out.pQuestions.length} pair=${out.pairBank.length} pair2=${out.pair2Bank.length}`);
