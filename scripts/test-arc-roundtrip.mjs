import { readFileSync } from 'node:fs';
import { parseSExpr } from '../src/lib/sexpr-parser.js';
import { writeLegacySymbolLib } from '../src/lib/sym-legacy-writer.js';
import { readdirSync, statSync } from 'node:fs';

function walk(dir, out=[]) {
  for (const n of readdirSync(dir)) {
    const p = `${dir}/${n}`;
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (n.endsWith('.kicad_sym')) out.push(p);
  }
  return out;
}

const files = walk('asset/kicad6');
let arcs=0, bad=0, files_with_arcs=0;
for (const f of files) {
  let lib;
  try { lib = writeLegacySymbolLib(parseSExpr(readFileSync(f,'utf8')), []).lib; }
  catch { continue; }
  const aLines = lib.split('\n').filter(l => l.startsWith('A '));
  if (aLines.length) files_with_arcs++;
  for (const l of aLines) {
    // A cx cy r t1 t2 unit convert width fill sx sy ex ey
    const t = l.split(/\s+/);
    const cx=+t[1], cy=+t[2], r=+t[3], t1=+t[4]/10, t2=+t[5]/10;
    const sx=+t[10], sy=+t[11], ex=+t[12], ey=+t[13];
    if ([cx,cy,r,t1,t2,sx,sy,ex,ey].some(v=>!isFinite(v))) { bad++; continue; }
    arcs++;
    const px1=cx+r*Math.cos(t1*Math.PI/180), py1=cy+r*Math.sin(t1*Math.PI/180);
    const px2=cx+r*Math.cos(t2*Math.PI/180), py2=cy+r*Math.sin(t2*Math.PI/180);
    // tolerance 1 mil (rounding of center/radius to integer mils)
    if (Math.hypot(px1-sx,py1-sy)>1.5 || Math.hypot(px2-ex,py2-ey)>1.5) {
      bad++;
      if (bad<=5) console.log(`  ✗ ${f.split('/').pop()}: ${l}\n     t1→(${px1.toFixed(1)},${py1.toFixed(1)}) vs start(${sx},${sy}); t2→(${px2.toFixed(1)},${py2.toFixed(1)}) vs end(${ex},${ey})`);
    }
  }
}
console.log(`\nScanned ${files.length} .kicad_sym, ${files_with_arcs} with arcs; checked ${arcs} arcs; ${bad} inconsistent`);
console.log(bad===0?'✅ ALL ARC ANGLES↔ENDPOINTS CONSISTENT':`❌ ${bad} inconsistent`);
process.exit(bad?1:0);
