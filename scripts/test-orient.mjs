import { readFileSync } from 'node:fs';
import { convertKicad } from '../src/lib/converter.js';
import { parseSExpr, findChild, findChildren } from '../src/lib/sexpr-parser.js';

// Independent KiCad reference: angle base matrix, then mirror via m_transform*temp
// (exact formula from KiCad 6 sch_symbol.cpp SetOrientation).
function kicadRef(angle, mirror) {
  let m;
  switch(((angle%360)+360)%360){
    case 0:m=[1,0,0,-1];break; case 90:m=[0,-1,-1,0];break;
    case 180:m=[-1,0,0,1];break; case 270:m=[0,1,1,0];break; default:m=[1,0,0,-1];
  }
  const mul=(a,t)=>[a[0]*t[0]+a[2]*t[1], a[1]*t[0]+a[3]*t[1], a[0]*t[2]+a[2]*t[3], a[1]*t[2]+a[3]*t[3]];
  if(mirror==='x') m=mul(m,[1,0,0,-1]);
  else if(mirror==='y') m=mul(m,[-1,0,0,1]);
  return m.join(' ');
}

let fail=0, checked=0;
const combos=new Set();
const files=[
  'asset/kicad6/video/esvideo.kicad_sch',
  'asset/kicad6/flat_hierarchy/pic_programmer.kicad_sch',
  'asset/kicad6/complex_hierarchy/ampli_ht.kicad_sch',
];
for (const path of files){
  const text=readFileSync(path,'utf8');
  const ast=parseSExpr(text);
  // ref -> {angle, mirror} from K6
  const want={};
  for (const s of findChildren(ast,'symbol')){
    const at=findChild(s,'at'); if(!at)continue;
    const angle=Math.round(parseFloat(at.children[2]?.value)||0);
    const mir=findChild(s,'mirror')?.children[0]?.value;
    const unit=findChild(s,'unit')?.children[0]?.value||'1';
    let ref=''; for(const p of findChildren(s,'property')){if(p.children[0]?.value==='Reference'){ref=p.children[1]?.value;break;}}
    if(ref) want[ref+'#'+unit]={angle,mirror:mir};
  }
  // ref -> matrix from generated .sch
  const r=await convertKicad(text,'KICAD5',path.split('/').pop());
  const sch=r.outputFiles.find(f=>f.name.endsWith('.sch')).content;
  const re=/\$Comp\n L? ?L (\S+) (\S+)[\s\S]*?\n\t-?\d[\s\S]*?\n\t(-?\d+ +-?\d+ +-?\d+ +-?\d+)\n\$EndComp/g;
  // simpler: split on $Comp blocks
  for (const block of sch.split('$Comp').slice(1)){
    const lref=block.match(/^\s*L \S+ (\S+)/m); if(!lref)continue;
    const ref=lref[1];
    const um=block.match(/^U (\d+)/m); const key=ref+'#'+(um?um[1]:'1');
    const mlines=[...block.matchAll(/^\t(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*$/gm)];
    if(!mlines.length||!want[key])continue;
    const got=mlines[mlines.length-1].slice(1,5).join(' ');
    const exp=kicadRef(want[key].angle, want[key].mirror);
    combos.add(`${want[key].angle}/${want[key].mirror||'none'}`);
    checked++;
    if(got!==exp){fail++; console.log(`✗ ${path.split('/').pop()} ${ref} (ang=${want[key].angle} mir=${want[key].mirror||'-'}): got [${got}] expected [${exp}]`);}
  }
}
console.log(`Checked ${checked} components; combos seen: ${[...combos].sort().join(', ')}`);
console.log(fail===0?'\n✅ ALL ORIENTATION MATRICES MATCH KICAD':`\n❌ ${fail} mismatches`);
process.exit(fail?1:0);
