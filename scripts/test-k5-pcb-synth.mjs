// Self-contained KiCad 6 → KiCad 5 PCB regression (no asset files needed).
//
// Exercises every K5-specific board rule found while debugging real KiCad-5 load
// failures, using one hand-written K6 board that packs all the tricky cases:
//   P50  (generator pcbnew)            → (host pcbnew "(5.1.5)")  [3-token header]
//   P50b (paper "A4")                  → (page "A4")
//   P51  User.1..User.9 layer defs     → removed (no K5 slot)
//   P51b object refs to User.N         → remapped to Dwgs.User; *.Cu / F&B.Cu kept
//   P61  K6 parametric (dimension ...) → dropped (lossy)
//   P62  model (offset (xyz ...))      → (at (xyz ...))
//   P63  (fill ...) on graphics        → removed (K5 graphic parser rejects it)
//   rectToLines width                  → numeric (regression: was "[object Object]")
//
// Usage: node scripts/test-k5-pcb-synth.mjs
import { applyPcbK6toK5 } from '../src/lib/pcb-converter.js';
import { parseSExpr, serializeSExpr } from '../src/lib/sexpr-parser.js';

const SRC = `(kicad_pcb (version 20211014) (generator pcbnew)
  (general (thickness 1.6))
  (paper "A4")
  (layers
    (0 "F.Cu" signal) (31 "B.Cu" signal)
    (40 "Dwgs.User" user) (41 "Cmts.User" user)
    (50 "User.1" user) (51 "User.2" user) (58 "User.9" user)
  )
  (setup (pad_to_mask_clearance 0) (pcbplotparams (svgprecision 6) (dxfpolygonmode true)))
  (footprint "lib:CLIFF_FC68148(DC-10A)" (layer "F.Cu") (at 10 10)
    (pad "1" thru_hole circle (at 0 0) (size 1 1) (drill 0.5) (layers "*.Cu" "*.Mask"))
    (fp_rect (start 0 0) (end 2 2) (stroke (width 0.1) (type solid)) (fill yes) (layer "F.SilkS"))
    (fp_poly (pts (xy 0 0) (xy 1 0) (xy 1 1)) (stroke (width 0.15) (type solid)) (fill solid) (layer "F.SilkS"))
    (model "x.wrl" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))
  )
  (gr_line (start 0 0) (end 5 0) (layer "User.1") (width 0.2))
  (gr_text "stranded" (at 0 0) (layer "User.3"))
  (dimension (type aligned) (layer "Dwgs.User") (pts (xy 0 0) (xy 10 0)) (height 2)
    (gr_text "10mm" (at 5 -2) (layer "Dwgs.User")) (format (units 3)) (style (thickness 0.2)))
  (group "" (id abc) (members "uuid-1" "uuid-2"))
)`;

let failures = 0;
function check(cond, msg) {
    if (!cond) { console.log(`  ✗ ${msg}`); failures++; } else console.log(`  ✓ ${msg}`);
}

const ast = parseSExpr(SRC);
await applyPcbK6toK5(ast, [], []);
const out = serializeSExpr(ast);
const count = (re) => (out.match(re) || []).length;

check(/\(module "lib:CLIFF_FC68148\(DC-10A\)"/.test(out), 'P53  module name with parens stays quoted');
check(/\(host pcbnew "\(5\.1\.5\)"\)/.test(out), 'P50  header → (host pcbnew "(5.1.5)") [3 tokens]');
check(!/\(generator\b/.test(out), 'P50  no (generator ...) remains');
check(/\(page "?A4"?\)/.test(out) && !/\(paper\b/.test(out), 'P50b (paper) → (page)');
check(count(/User\.[0-9]/g) === 0, 'P51  all User.N gone (defs + refs)');
check(count(/\*\.Cu/g) === 1 && count(/\*\.Mask/g) === 1, 'P51b pad *.Cu / *.Mask wildcards preserved');
check(count(/\(layer Dwgs\.User\)/g) >= 2, 'P51b both stranded objects remapped → Dwgs.User');
check(!/\(dimension\b/.test(out), 'P61  K6 dimension dropped');
check(/\(at \(xyz 0 0 0\)\)/.test(out) && !/\(offset \(xyz/.test(out), 'P62  model offset → at');
check(count(/\(fill\b/g) === 0, 'P63  no (fill ...) on graphic shapes');
check(count(/\(group\b/g) === 0, 'P64  no (group ...) nodes remain');
check(!out.includes('[object Object]'), 'rectToLines width is numeric (no [object Object])');
check(count(/\(fp_line\b/g) >= 4, 'rectToLines expanded fp_rect → 4 fp_line');

// every concrete layer ref must be a real K5 layer (or a *. / & set token)
const K5 = new Set(['F.Cu', 'B.Cu', ...Array.from({ length: 30 }, (_, i) => `In${i + 1}.Cu`),
    'B.Adhes', 'F.Adhes', 'B.Paste', 'F.Paste', 'B.SilkS', 'F.SilkS', 'B.Mask', 'F.Mask',
    'Dwgs.User', 'Cmts.User', 'Eco1.User', 'Eco2.User', 'Edge.Cuts', 'Margin',
    'B.CrtYd', 'F.CrtYd', 'B.Fab', 'F.Fab']);
let badLayer = null;
(function w(n) {
    if (!n || n.type !== 'list' || badLayer) return;
    if (n.name === 'layer') {
        for (const c of n.children) if ((c.type === 'atom' || c.type === 'string')
            && !K5.has(c.value) && !c.value.includes('*') && !c.value.includes('&')) badLayer = c.value;
    }
    for (const c of n.children) w(c);
})(parseSExpr(out));
check(!badLayer, `every (layer ...) ref is K5-valid${badLayer ? ` (offender: ${badLayer})` : ''}`);

// Every (module ...) child must be in KiCad 5's module grammar (verbatim from the
// K5 parse error: "Expecting locked, placed, tedit, ... pad, or model"), plus the
// leading elements parsed before the switch (version, layer).
const K5_MODULE = new Set(['version', 'layer', 'locked', 'placed', 'tedit', 'tstamp', 'at',
    'descr', 'tags', 'path', 'autoplace_cost90', 'autoplace_cost180', 'solder_mask_margin',
    'solder_paste_margin', 'solder_paste_ratio', 'clearance', 'zone_connect', 'thermal_width',
    'thermal_gap', 'attr', 'fp_text', 'fp_arc', 'fp_circle', 'fp_curve', 'fp_line', 'fp_poly',
    'pad', 'model']);
let badModChild = null;
(function w(n) {
    if (!n || n.type !== 'list' || badModChild) return;
    if (n.name === 'module') {
        for (const c of n.children) if (c.type === 'list' && !K5_MODULE.has(c.name)) badModChild = c.name;
    }
    for (const c of n.children) w(c);
})(parseSExpr(out));
check(!badModChild, `every (module ...) child is K5-valid${badModChild ? ` (offender: ${badModChild})` : ''}`);

console.log(failures === 0 ? '\n✅ ALL CHECKS PASSED' : `\n❌ ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
