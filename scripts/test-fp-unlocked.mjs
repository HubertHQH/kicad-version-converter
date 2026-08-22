import assert from 'node:assert/strict';
import { convertKicad } from '../src/lib/converter.js';

const input = `(footprint "Unlocked text" (version 20221018) (generator pcbnew)
  (layer "F.Cu")
  (fp_text reference "~" (at 0 -2.54 unlocked) (layer "F.SilkS") hide
    (effects (font (size 1 1) (thickness 0.15))))
  (fp_text user "+" (at -4.191 -1.905 90 unlocked) (layer "F.SilkS")
    (effects (font (size 1 1) (thickness 0.15))))
  (pad "1" thru_hole circle (at 0 0) (size 2 2) (drill 1) (layers "*.Cu" "*.Mask")))`;

const k5 = await convertKicad(input, 'KICAD5', 'Unlocked text.kicad_mod');
assert.match(k5.output, /^\(module /);
assert.doesNotMatch(k5.output, /\(at [^)]*\bunlocked\b/);
assert.ok(k5.log.includes('F39 fp_text (at ...) unlocked flags removed: 2'));

// KiCad 6 and 7 accept this flag, so conversions to those versions preserve it.
for (const target of ['KICAD6', 'KICAD7']) {
    const result = await convertKicad(input, target, 'Unlocked text.kicad_mod');
    assert.equal((result.output.match(/\bunlocked\b/g) || []).length, 2);
}

console.log('✓ fp_text (at ... unlocked) is removed only from KiCad 5 output');
