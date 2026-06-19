import { readFileSync } from 'node:fs';
import { convertKicad } from '../src/lib/converter.js';
import { parseSExpr, findChild, findChildren } from '../src/lib/sexpr-parser.js';

// Independent KiCad rule: angle->spin {0:2,90:1,180:0,270:3}; global/hier file=spin;
// local/text file=swap0<->2(spin). (From sch_legacy_plugin loadText comment table.)
function kicadLabelOrient(angle, directional){
  const a=((Math.round(angle)%360)+360)%360;
  const spin={0:2,90:1,180:0,270:3}[a]??2;
  return directional ? spin : (spin===0?2:spin===2?0:spin);
}
const mil=mm=>Math.round(parseFloat(mm)/0.0254);

const f='asset/kicad6/video/bus_pci.kicad_sch';
const ast=parseSExpr(readFileSync(f,'utf8'));
// source: pos(mil) -> {angle, directional}
const src=new Map();
for(const nm of ['label','global_label','hierarchical_label','text']){
  for(const n of findChildren(ast,nm)){
    const at=findChild(n,'at'); if(!at)continue;
    const x=mil(at.children[0]?.value), y=mil(at.children[1]?.value);
    const angle=Math.round(parseFloat(at.children[2]?.value)||0);
    const directional=(nm==='global_label'||nm==='hierarchical_label');
    src.set(x+','+y, {angle, directional});
  }
}
const r=await convertKicad(readFileSync(f,'utf8'),'KICAD5','bus_pci.kicad_sch');
const sch=r.outputFiles.find(x=>x.name.endsWith('.sch')).content.split('\n');
let checked=0, fail=0;
for(const line of sch){
  const m=line.match(/^Text (Label|GLabel|HLabel|Notes) (-?\d+) (-?\d+) (\d)\b/);
  if(!m)continue;
  const kind=m[1], x=+m[2], y=+m[3], orient=+m[4];
  const s=src.get(x+','+y); if(!s)continue;
  const directional=(kind==='GLabel'||kind==='HLabel');
  const exp=kicadLabelOrient(s.angle, directional);
  checked++;
  if(orient!==exp){ fail++; if(fail<=6) console.log(`  ✗ ${kind}@(${x},${y}) ang=${s.angle}: got ${orient} exp ${exp}`); }
}
// ground-truth spot checks vs KiCad 5 demo
const gt={'PTWR':2,'RDEMPTY':2,'PTNUM1':2,'IRQ_SRL':0,'ADR2':0,'DQ0':0};
let gfail=0;
for(let i=0;i<sch.length;i++){
  const t=sch[i+1];
  if(sch[i].startsWith('Text ') && t && gt[t.trim()]!==undefined){
    const o=+sch[i].match(/^Text \w+ -?\d+ -?\d+ (\d)/)[1];
    const ok=o===gt[t.trim()];
    console.log(`  ${ok?'✓':'✗'} ${t.trim()}: orient ${o} (KiCad demo: ${gt[t.trim()]})`);
    if(!ok)gfail++;
  }
}
console.log(`\nPosition-matched ${checked} labels, ${fail} mismatch vs KiCad rule; ground-truth ${gfail} fail`);
console.log(fail===0&&gfail===0?'✅ LABEL ORIENTATION CORRECT':'❌ FAIL');
process.exit(fail||gfail?1:0);
