import { readFileSync } from 'node:fs';
import { convertKicad } from '../src/lib/converter.js';
let fail=0;
const schs = [
  'asset/kicad6/flat_hierarchy/pic_sockets.kicad_sch',
  'asset/kicad6/complex_hierarchy/ampli_ht.kicad_sch',
  'asset/kicad6/video/esvideo.kicad_sch',
];
for (const path of schs) {
  const fn = path.split('/').pop();
  const res = await convertKicad(readFileSync(path,'utf8'),'KICAD5',fn);
  const sch = res.outputFiles.find(f=>f.name.endsWith('.sch')).content;
  const cache = res.outputFiles.find(f=>f.name.endsWith('-cache.lib'));
  // collect cache symbol names (DEF + ALIAS)
  const cacheNames = new Set();
  if (cache) {
    for (const m of cache.content.matchAll(/^DEF (\S+) /gm)) cacheNames.add(m[1]);
    for (const m of cache.content.matchAll(/^ALIAS (.+)$/gm)) m[1].trim().split(/\s+/).forEach(n=>cacheNames.add(n));
  }
  // collect L-line lib ids → expected cache key (':'->'_')
  const libIds = [...sch.matchAll(/^L (\S+) \S+$/gm)].map(m=>m[1]);
  const expected = [...new Set(libIds.map(id=>id.replace(/:/g,'_')))];
  const missing = expected.filter(e=>!cacheNames.has(e));
  const okAll = missing.length===0 && expected.length>0;
  console.log(`${okAll?'✓':'✗'} ${fn}: ${expected.length} distinct lib_ids, cache has ${cacheNames.size} names, missing=${missing.length}`);
  if (missing.length) { console.log('    e.g. L-id needs:', missing.slice(0,4)); fail++; }
  // sanity: no colon in any DEF/ALIAS name (illegal in legacy)
  const badColon = [...cacheNames].filter(n=>n.includes(':'));
  if (badColon.length) { console.log('    ✗ cache names contain illegal colon:', badColon.slice(0,3)); fail++; }
}
console.log(fail===0?'\n✅ CACHE NAMES MATCH L-LINES':`\n❌ ${fail} mismatch`);
process.exit(fail?1:0);
