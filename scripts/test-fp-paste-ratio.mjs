import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { convertKicad } from '../src/lib/converter.js';
import { parseSExpr, findChild, findChildren, getChildValue } from '../src/lib/sexpr-parser.js';

const original = readFileSync(new URL('../bug/TEST_ERR_original_v9.kicad_mod', import.meta.url), 'utf8');
const targets = ['KICAD8', 'KICAD7', 'KICAD6', 'KICAD5'];

// The reported footprint must retain its explicit -0 value under the old token.
for (const target of targets) {
    const result = await convertKicad(original, target, 'TEST_ERR.kicad_mod');
    const fp = parseSExpr(result.output);
    assert.equal(getChildValue(fp, 'solder_paste_ratio'), '-0', target);
    assert.equal(findChild(fp, 'solder_paste_margin_ratio'), null, target);
    assert.equal(findChildren(fp, 'pad').length, 2, target);
    assert.equal(findChildren(fp, 'fp_line').length, 6, target);
    assert.ok(result.log.includes('F5 solder_paste_margin_ratio→solder_paste_ratio renamed: 1'));
}

// Footprint and pad parsers use DIFFERENT names before KiCad 9. Exercise both
// standalone libraries and board-embedded footprints, including chained K10 input.
for (const version of ['20241229', '20260206']) {
    for (const ratio of ['-0', '0', '-0.15', '0.125']) {
        const body = `(layer "F.Cu")
          (solder_mask_margin 0.03) (solder_paste_margin -0.02)
          (solder_paste_margin_ratio ${ratio}) (clearance 0.2032)
          (pad "1" smd rect (at 0 0) (size 2 1) (layers "F.Cu" "F.Paste" "F.Mask")
            (solder_paste_margin -0.01) (solder_paste_margin_ratio -0.25))`;
        for (const board of [false, true]) {
            const header = `(version ${version}) (generator "pcbnew")`;
            const input = board
                ? `(kicad_pcb ${header} (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
                    (footprint "Paste ratio" ${body}))`
                : `(footprint "Paste ratio" ${header} ${body})`;
            const name = board ? 'ratio.kicad_pcb' : 'ratio.kicad_mod';
            for (const target of [...targets, 'KICAD9']) {
                const result = await convertKicad(input, target, name);
                const ast = parseSExpr(result.output);
                const fp = board ? findChild(ast, target === 'KICAD5' ? 'module' : 'footprint') : ast;
                const token = target === 'KICAD9' ? 'solder_paste_margin_ratio' : 'solder_paste_ratio';
                const otherToken = target === 'KICAD9' ? 'solder_paste_ratio' : 'solder_paste_margin_ratio';
                assert.equal(getChildValue(fp, token), ratio, `${version} ${name} ${target}`);
                assert.equal(findChild(fp, otherToken), null);
                assert.equal(getChildValue(fp, 'solder_mask_margin'), '0.03');
                assert.equal(getChildValue(fp, 'solder_paste_margin'), '-0.02');
                assert.equal(getChildValue(fp, 'clearance'), '0.2032');
                const pad = findChild(fp, 'pad');
                assert.equal(getChildValue(pad, 'solder_paste_margin_ratio'), '-0.25');
                assert.equal(findChild(pad, 'solder_paste_ratio'), null);
                assert.equal(getChildValue(pad, 'solder_paste_margin'), '-0.01');
            }
        }
    }
}

// Already-legacy tokens and absent overrides must not gain duplicate/default fields.
for (const override of ['', '(solder_paste_ratio -0.1)']) {
    const input = `(footprint "Legacy" (version 20241229) (generator "pcbnew")
        (layer "F.Cu") ${override})`;
    const result = await convertKicad(input, 'KICAD5', 'legacy.kicad_mod');
    const fp = parseSExpr(result.output);
    assert.equal(findChildren(fp, 'solder_paste_ratio').length, override ? 1 : 0);
    if (override) assert.equal(getChildValue(fp, 'solder_paste_ratio'), '-0.1');
}

console.log('✓ Paste ratios preserved across K9/K10 → K8/K7/K6/K5, with footprint/pad token scope');
