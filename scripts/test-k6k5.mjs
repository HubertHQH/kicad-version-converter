// Ad-hoc verification harness for KiCad 6 → KiCad 5 conversion.
// Usage: node scripts/test-k6k5.mjs
import { readFileSync } from 'node:fs';
import { convertKicad } from '../src/lib/converter.js';
import { parseSExpr } from '../src/lib/sexpr-parser.js';

const ASSET = 'asset/kicad6';

const pcbs = [
    `${ASSET}/complex_hierarchy/complex_hierarchy.kicad_pcb`,
    `${ASSET}/flat_hierarchy/flat_hierarchy.kicad_pcb`,
    `${ASSET}/pic_programmer/pic_programmer.kicad_pcb`,
    `${ASSET}/video/video.kicad_pcb`,
];

let failures = 0;
function check(cond, msg) {
    if (!cond) { console.log(`   ✗ ${msg}`); failures++; }
    else console.log(`   ✓ ${msg}`);
}

// Value-level validation (KiCad 5's strict parser runs parseDouble on these).
// Catches JS-coercion bugs like (width [object Object]) that re-parse fine but
// make KiCad 5 reject the file with "need a NUMBER".
const NUM1 = new Set(['width', 'thickness']);                 // single number
const NUM2 = new Set(['start', 'end', 'center', 'mid', 'xy']); // x y pair
function badNumericField(ast) {
    let bad = null;
    (function w(n) {
        if (!n || n.type !== 'list' || bad) return;
        const a = n.children.filter(c => c.type === 'atom' || c.type === 'string').map(c => c.value);
        if (NUM1.has(n.name) && (a.length < 1 || !isFinite(Number(a[0])))) bad = `(${n.name} ${a.join(' ')})`;
        if (NUM2.has(n.name) && (a.length < 2 || !isFinite(Number(a[0])) || !isFinite(Number(a[1])))) bad = `(${n.name} ${a.join(' ')})`;
        for (const c of n.children) w(c);
    })(ast);
    return bad;
}
function graphicFill(ast) {
    const SHAPES = new Set(['gr_line', 'gr_arc', 'gr_circle', 'gr_poly', 'gr_curve',
        'fp_line', 'fp_arc', 'fp_circle', 'fp_poly', 'fp_curve']);
    let found = false;
    (function w(n) {
        if (!n || n.type !== 'list' || found) return;
        if (SHAPES.has(n.name) && n.children.some(c => c.type === 'list' && c.name === 'fill')) found = true;
        for (const c of n.children) w(c);
    })(ast);
    return found;
}

for (const path of pcbs) {
    console.log(`\n=== ${path} ===`);
    const input = readFileSync(path, 'utf8');
    let res;
    try {
        res = await convertKicad(input, 'KICAD5', path.split('/').pop());
    } catch (e) {
        console.log(`   ✗ THREW: ${e.message}\n${e.stack}`);
        failures++;
        continue;
    }
    const out = res.output;
    check(/\(version 20171130\)/.test(out), 'version stamped 20171130');
    check(!/\(footprint /.test(out), 'no (footprint ...) remains');
    check(/\(module /.test(out), 'has (module ...)');
    check(!/\btstamp\b/.test(out), 'no tstamp remains');
    check(!/\buuid\b/.test(out), 'no uuid remains');
    check(!/\bmid\b/.test(out) || !/fp_arc[^)]*\bmid\b/.test(out), 'no fp_arc (mid ...) remains');
    check(!/roundrect/.test(out), 'no roundrect pad shape/rratio remains');
    check(!/\bcustom\b/.test(out) || !/\(pad[^\n]*\bcustom\b/.test(out), 'no custom pad shape remains');
    check(!/stackup/.test(out), 'no stackup remains');
    check(!/\(paper\b/.test(out) && /\(page\b/.test(out), '(paper ...) → (page ...)');
    check(!out.includes('[object Object]'), 'no [object Object] coercion artifacts');
    // Re-parse to confirm output is structurally valid S-expression
    try {
        const ast = parseSExpr(out);
        check(ast && ast.name === 'kicad_pcb', 're-parses as kicad_pcb');
        const bad = badNumericField(ast);
        check(!bad, `all width/coord fields numeric${bad ? ` (offender: ${bad})` : ''}`);
        check(!graphicFill(ast), 'no (fill ...) on graphic shapes');
    } catch (e) {
        check(false, `re-parse failed: ${e.message}`);
    }
    // Report a couple of stat lines from the log
    const summary = res.log.filter(l => /^P5\d|^P60|arcs converted|→ modules/.test(l));
    summary.forEach(l => console.log(`     · ${l.trim()}`));
}

// --- Footprints: convert K9 .kicad_mod through the chain down to K5 (exercises
//     applyFpK6toK5 as the final step) and verify legacy (module ...) output. ---
const footprints = [
    `${ASSET}/../kicad9/complex_hierarchy/complex_hierarchy.pretty/DIP-8_W7.62mm_LongPads.kicad_mod`,
    `${ASSET}/../kicad9/complex_hierarchy/complex_hierarchy.pretty/TO-92_HandSolder.kicad_mod`,
    `${ASSET}/../kicad9/flat_hierarchy/libs/pic_programmer_fp.pretty/DIP-14_W7.62mm_LongPads.kicad_mod`,
];
for (const path of footprints) {
    console.log(`\n=== ${path.split('/').pop()} (footprint K9→K5) ===`);
    let res;
    try {
        res = await convertKicad(readFileSync(path, 'utf8'), 'KICAD5', path.split('/').pop());
    } catch (e) {
        console.log(`   ✗ THREW: ${e.message}`); failures++; continue;
    }
    const out = res.output;
    check(out.trimStart().startsWith('(module '), 'root is (module ...)');
    check(!/\(version /.test(out), 'no (version ...) header');
    check(!/\(generator/.test(out), 'no (generator ...) header');
    check(/\(tedit /.test(out), 'has (tedit ...)');
    check(!/\btstamp\b/.test(out) && !/\buuid\b/.test(out), 'no tstamp/uuid');
    check(!/\(fp_arc[\s\S]{0,80}\bmid\b/.test(out), 'no fp_arc (mid ...)');
    check(!out.includes('[object Object]'), 'no [object Object] coercion artifacts');
    try {
        const ast = parseSExpr(out);
        check(ast && ast.name === 'module', 're-parses as module');
        const bad = badNumericField(ast);
        check(!bad, `all width/coord fields numeric${bad ? ` (offender: ${bad})` : ''}`);
        check(!graphicFill(ast), 'no (fill ...) on graphic shapes');
    } catch (e) { check(false, `re-parse failed: ${e.message}`); }
}

// --- Symbol libraries: K6 .kicad_sym → legacy .lib (+.dcm) via convertKicad ---
const symLibs = [
    `${ASSET}/flat_hierarchy/libs/flat_hierarchy_schlib.kicad_sym`,
    `${ASSET}/complex_hierarchy/complex_hierarchy_schlib.kicad_sym`,
];
for (const path of symLibs) {
    const fn = path.split('/').pop();
    console.log(`\n=== ${fn} (symbol K6→K5) ===`);
    let res;
    try { res = await convertKicad(readFileSync(path, 'utf8'), 'KICAD5', fn); }
    catch (e) { console.log(`   ✗ THREW: ${e.message}`); failures++; continue; }
    check(Array.isArray(res.outputFiles) && res.outputFiles.length >= 1, 'returns outputFiles');
    const lib = res.outputFiles.find(f => f.name.endsWith('.lib'));
    check(!!lib, 'has a .lib output');
    check(lib && lib.content.startsWith('EESchema-LIBRARY Version 2.4'), '.lib header correct');
    check(lib && lib.name === fn.replace('.kicad_sym', '.lib'), `.lib name = ${fn.replace('.kicad_sym', '.lib')}`);
    const defs = lib ? (lib.content.match(/^DEF /gm) || []).length : 0;
    const ends = lib ? (lib.content.match(/^ENDDEF$/gm) || []).length : 0;
    check(defs > 0 && defs === ends, `DEF/ENDDEF balanced (${defs})`);
}

// --- Schematics: K6 .kicad_sch → legacy .sch (+ cache) via convertKicad ---
const schFiles = [
    `${ASSET}/flat_hierarchy/pic_sockets.kicad_sch`,
    `${ASSET}/flat_hierarchy/flat_hierarchy.kicad_sch`,
    `${ASSET}/complex_hierarchy/ampli_ht.kicad_sch`,
];
for (const path of schFiles) {
    const fn = path.split('/').pop();
    console.log(`\n=== ${fn} (schematic K6→K5) ===`);
    let res;
    try { res = await convertKicad(readFileSync(path, 'utf8'), 'KICAD5', fn); }
    catch (e) { console.log(`   ✗ THREW: ${e.message}`); failures++; continue; }
    const sch = res.outputFiles.find(f => f.name.endsWith('.sch'));
    check(!!sch, 'has a .sch output');
    check(sch && sch.content.startsWith('EESchema Schematic File Version 4'), '.sch header correct');
    check(sch && /\$EndSCHEMATC/.test(sch.content), 'has $EndSCHEMATC');
    const comps = sch ? (sch.content.match(/^\$Comp$/gm) || []).length : 0;
    const ecomps = sch ? (sch.content.match(/^\$EndComp$/gm) || []).length : 0;
    check(comps === ecomps, `$Comp/$EndComp balanced (${comps})`);
    check(!/\.kicad_sch/.test(sch ? sch.content : ''), 'no .kicad_sch refs remain (sheets → .sch)');
}

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
