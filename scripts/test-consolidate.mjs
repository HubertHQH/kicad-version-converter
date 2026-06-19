import { readFileSync, readdirSync } from 'node:fs';
import { convertKicad, detectSchematicRoot, mergeCacheLibs } from '../src/lib/converter.js';
let fail=0; const ok=(c,m)=>{console.log(`${c?'✓':'✗'} ${m}`); if(!c)fail++;};

const dir = 'asset/kicad6/video';
const files = readdirSync(dir).filter(n=>n.endsWith('.kicad_sch'))
  .map(n=>({name:n, content:readFileSync(`${dir}/${n}`,'utf8')}));

const root = detectSchematicRoot(files);
ok(root==='video', `detectSchematicRoot → "${root}" (expect "video")`);

// Simulate App batch: convert each with cacheBaseName=root, collect caches, merge
let converted=[];
for (const f of files) {
  const r = await convertKicad(f.content,'KICAD5',f.name,{cacheBaseName:root});
  for (const o of r.outputFiles) converted.push(o);
}
const cacheName = `${root}-cache.lib`;
ok(converted.every(f=>!f.name.endsWith('-cache.lib') || f.name===cacheName),
   'every emitted cache is named <root>-cache.lib');
const parts = converted.filter(f=>f.name===cacheName).map(f=>f.content);
ok(parts.length===files.length, `${parts.length} per-sheet caches collected (expect ${files.length})`);
const merged = mergeCacheLibs(parts);

// Build set of merged cache symbol names (DEF + ALIAS)
const names = new Set();
for (const m of merged.matchAll(/^DEF (\S+) /gm)) names.add(m[1]);
for (const m of merged.matchAll(/^ALIAS (.+)$/gm)) m[1].trim().split(/\s+/).forEach(n=>names.add(n));

// Every L-line lib_id across ALL sheets must be in the merged cache (':'→'_')
let totalIds=0, missingTotal=0;
for (const f of converted.filter(f=>f.name.endsWith('.sch'))) {
  const ids=[...new Set([...f.content.matchAll(/^L (\S+) \S+$/gm)].map(m=>m[1].replace(/:/g,'_')))];
  totalIds+=ids.length;
  const missing=ids.filter(id=>!names.has(id));
  missingTotal+=missing.length;
  if(missing.length) console.log(`   ✗ ${f.name}: missing ${missing.slice(0,3).join(', ')}`);
}
ok(missingTotal===0, `all ${totalIds} lib_ids across ${files.length} sheets resolve in merged cache`);
ok(!merged.includes(':'), 'merged cache has no illegal colons in names');
const defCount=(merged.match(/^DEF /gm)||[]).length;
console.log(`   merged cache: ${defCount} DEFs, ${names.size} resolvable names`);

console.log(fail===0?'\n✅ CONSOLIDATION OK':`\n❌ ${fail} failed`);
process.exit(fail?1:0);
