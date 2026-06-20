// Self-contained KiCad 10.99 → KiCad 10 regression (schematic + PCB; no assets).
//
// KiCad 10.99 is the development/nightly line (future KiCad 11). This exercises
// every 10.99 → 10 rule plus detection, generator-only detection, the
// pass-through cases that must NOT trigger, and a chained 10.99 → K9 downgrade.
//
//   Schematic  D1 header → 20260306 / generator 10.0
//              D2 (ellipse)/(ellipse_arc) removed   D3 (net_chain) removed
//              D4 (locked) removed
//   PCB        DP1 header → 20260206 / generator 10.0
//              DP2 extruded/gr_ellipse/spec_frequency/net_chain/thieving removed
//              DP3 (model (type ...)) removed, plain model kept
//              DP4 zone fill (mode thieving) → polygon
//              DP5 table_cell (knockout) removed   DP6 pad (sim_electrical_type) removed
//
// Usage: node scripts/test-k1099-k10.mjs
import { convertKicad, detectVersion } from '../src/lib/converter.js';
import { parseSExpr } from '../src/lib/sexpr-parser.js';

let failures = 0;
function check(cond, msg) {
    if (!cond) { console.log(`  ✗ ${msg}`); failures++; } else console.log(`  ✓ ${msg}`);
}
const count = (s, re) => (s.match(re) || []).length;

// ---- synthetic 10.99 schematic (format bumped + 10.99-only primitives) -------
const SCH_1099 = `(kicad_sch
  (version 20260512)
  (generator "eeschema")
  (generator_version "10.99")
  (uuid "00000000-0000-0000-0000-000000000001")
  (paper "A4")
  (lib_symbols)
  (wire (pts (xy 0 0) (xy 10 0)) (stroke (width 0) (type default)))
  (ellipse (center 5 5) (radius 2 3) (stroke (width 0) (type default)) (fill (type none)))
  (ellipse_arc (center 1 1) (stroke (width 0) (type default)))
  (net_chain (uuid "aa") (members "n1" "n2"))
  (symbol (lib_id "Device:R") (at 20 20 0) (unit 1) (locked yes)
    (uuid "00000000-0000-0000-0000-0000000000aa")
    (property "Reference" "R1" (at 20 18 0))
    (property "Value" "10k" (at 20 22 0)))
)`;

// ---- synthetic 10.99 PCB (format 20260603 + 10.99-only objects/fields) -------
const PCB_1099 = `(kicad_pcb
  (version 20260603)
  (generator "pcbnew")
  (generator_version "10.99")
  (general (thickness 1.6))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (39 "User.1" user))
  (setup
    (stackup
      (layer "dielectric 1" (type "core") (thickness 1.5)
        (spec_frequency (freq 1e9) (epsilon_r 4.2))
        (dielectric_model "djordjevic-sarkar"))))
  (gr_ellipse (center 0 0) (end 5 0) (layer "F.SilkS") (width 0.1))
  (net_chain (members "GND"))
  (thieving (layer "F.Cu") (net 0))
  (footprint "lib:R_0402" (layer "F.Cu") (uuid "ff")
    (transform (translate 110.49 78.867) (rotate 180) (scale 1 1))
    (pad "1" smd roundrect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "VCC")
      (sim_electrical_type "passive"))
    (model "real.step" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))
    (model "gen" (type extruded) (extruded (outline (xy 0 0) (xy 1 1)))))
  (zone (net 0) (layer "F.Cu") (fill yes (mode thieving) (thermal_gap 0.5)))
  (table (cells
    (table_cell "a" (knockout) (span 1 1))))
)`;

// =============================================================================
console.log('— detection —');
const dSch = detectVersion(SCH_1099);
const dPcb = detectVersion(PCB_1099);
check(dSch.isKicad1099 === true && dSch.label === 'KiCad 10.99', 'schematic 20260512 detected as KiCad 10.99');
check(dPcb.isKicad1099 === true && dPcb.label === 'KiCad 10.99', 'PCB 20260603 detected as KiCad 10.99');

// a stable K10 file must NOT be mistaken for 10.99
const dK10 = detectVersion('(kicad_sch (version 20260306) (generator "eeschema") (generator_version "10.0"))');
check(dK10.isKicad1099 === false && dK10.label === 'KiCad 10', 'stable K10 schematic NOT flagged as 10.99');
const dK10pcb = detectVersion('(kicad_pcb (version 20260206) (generator "pcbnew") (generator_version "10.0"))');
check(dK10pcb.isKicad1099 === false && dK10pcb.label === 'KiCad 10', 'stable K10 PCB NOT flagged as 10.99');

// generator-only signal: format equals K10 but generator says 10.99
const dGen = detectVersion('(kicad_sch (version 20260306) (generator "eeschema") (generator_version "10.99"))');
check(dGen.isKicad1099 === true, 'schematic with K10 stamp but generator "10.99" detected as 10.99');

console.log('\n— schematic 10.99 → 10 —');
const rSch = await convertKicad(SCH_1099, 'KICAD10', 'test.kicad_sch');
const sOut = rSch.output;
check(/\(version 20260306\)/.test(sOut), 'D1 version → 20260306');
check(/\(generator_version "10\.0"\)/.test(sOut), 'D1 generator_version → "10.0"');
check(count(sOut, /\(ellipse\b/g) === 0, 'D2 (ellipse) removed');
check(count(sOut, /\(ellipse_arc\b/g) === 0, 'D2 (ellipse_arc) removed');
check(count(sOut, /\(net_chain\b/g) === 0, 'D3 (net_chain) removed');
check(count(sOut, /\(locked\b/g) === 0, 'D4 (locked) removed');
check(/\(symbol\b/.test(sOut) && /R1/.test(sOut), 'symbol + reference preserved');
check(!!parseSExpr(sOut), 'converted schematic re-parses');

console.log('\n— PCB 10.99 → 10 —');
const rPcb = await convertKicad(PCB_1099, 'KICAD10', 'test.kicad_pcb');
const pOut = rPcb.output;
check(/\(version 20260206\)/.test(pOut), 'DP1 version → 20260206');
check(/\(generator_version "10\.0"\)/.test(pOut), 'DP1 generator_version → "10.0"');
check(count(pOut, /\(gr_ellipse\b/g) === 0, 'DP2 (gr_ellipse) removed');
check(count(pOut, /\(spec_frequency\b/g) === 0, 'DP2 (spec_frequency) removed');
check(count(pOut, /\(dielectric_model\b/g) === 0, 'DP2 (dielectric_model) removed');
check(count(pOut, /\(net_chain\b/g) === 0, 'DP2 (net_chain) removed');
check(count(pOut, /\(thieving\b/g) === 0, 'DP2 standalone (thieving) object removed');
check(count(pOut, /\(extruded\b/g) === 0, 'DP2 (extruded) removed');
check(count(pOut, /\(type extruded\)/g) === 0 && !/\(model "gen"/.test(pOut), 'DP3 typed/extruded (model) removed');
check(/\(model "real\.step"/.test(pOut), 'DP3 plain (model "real.step") preserved');
check(/\(mode polygon\)/.test(pOut) && count(pOut, /\(mode thieving\)/g) === 0, 'DP4 zone fill mode thieving → polygon');
check(count(pOut, /\(knockout\b/g) === 0, 'DP5 table_cell (knockout) removed');
check(count(pOut, /\(sim_electrical_type\b/g) === 0, 'DP6 pad (sim_electrical_type) removed');
check(/\(pad "1"/.test(pOut) && /VCC/.test(pOut), 'pad + net preserved');
check(/User\.1/.test(pOut), 'DP-deviation: User.1 layer preserved (not K5-remapped)');
check(/\(at 110\.49 78\.867 180\)/.test(pOut), 'DP7 footprint (transform) → (at X Y A)');
check(count(pOut, /\(transform\b/g) === 0, 'DP7 no (transform) block remains');
check(count(pOut, /\(translate\b/g) === 0, 'DP7 no (translate) remains');
check(count(pOut, /\(rotate 180\)/g) === 0, 'DP7 bare (rotate 180) folded into (at)');
check(/\(scale\s*\(xyz 1 1 1\)\s*\)/.test(pOut), 'DP7 model (scale (xyz …)) preserved');
check(/\(rotate\s*\(xyz 0 0 0\)\s*\)/.test(pOut), 'DP7 model (rotate (xyz …)) preserved');
check(!!parseSExpr(pOut), 'converted PCB re-parses');

console.log('\n— chained 10.99 → K9 —');
const rChain = await convertKicad(PCB_1099, 'KICAD9', 'test.kicad_pcb');
const cOut = rChain.output;
check(/\(version 20241229\)/.test(cOut), 'chained version → K9 (20241229)');
check(count(cOut, /\(gr_ellipse\b/g) === 0 && count(cOut, /\(net_chain\b/g) === 0, 'chained: 10.99-only features still removed');
check(!!parseSExpr(cOut), 'chained K9 PCB re-parses');

console.log(failures === 0 ? '\n✅ ALL CHECKS PASSED' : `\n❌ ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
