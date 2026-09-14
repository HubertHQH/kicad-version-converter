# Footprint solder paste ratio regression

## Symptom and cause

Converting `TEST_ERR_original_v9.kicad_mod` to KiCad 7 or KiCad 5 previously left the footprint-level `(solder_paste_margin_ratio -0)` unchanged. KiCad 7 rejected the resulting token at line 29; in the supplied KiCad 5 output it appeared at line 26.

KiCad 9 renamed the footprint-level token. Earlier versions use different names depending on the parent object:

| Parent | KiCad 9 | KiCad 4–8 |
| --- | --- | --- |
| Footprint / legacy module | `solder_paste_margin_ratio` | `solder_paste_ratio` |
| Pad | `solder_paste_margin_ratio` | `solder_paste_margin_ratio` |

The parse failure comes from the footprint token, not the `-0` numeric value. The standalone footprint converter lacked this rename, and PCB rule P27 previously renamed pad tokens as well.

The fix adds footprint rule F5 at the KiCad 9 → 8 step and shares its scoped rename with PCB rule P27. Chained conversions to KiCad 7, 6, and 5 inherit the fix. Only direct footprint children are renamed; pad overrides, ratio values, and neighboring clearance fields are preserved.

Parser references: [KiCad 9.0.0](https://github.com/KiCad/kicad-source-mirror/blob/9.0.0/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.cpp), [8.0.0](https://github.com/KiCad/kicad-source-mirror/blob/8.0.0/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.cpp), [7.0.5](https://github.com/KiCad/kicad-source-mirror/blob/7.0.5/pcbnew/plugins/kicad/pcb_parser.cpp), [5.1.12](https://github.com/KiCad/kicad-source-mirror/blob/5.1.12/pcbnew/pcb_parser.cpp), [4.0.7](https://github.com/KiCad/kicad-source-mirror/blob/4.0.7/pcbnew/pcb_parser.cpp).

## Files and manual verification

- [Original KiCad 9 input](TEST_ERR_original_v9.kicad_mod)
- [Corrected KiCad 7 output](TEST_ERR_converted_v7.kicad_mod)
- [Corrected KiCad 5 output](TEST_ERR_converted_v5.kicad_mod)

The two converted files now contain the corrected output, not the original failing output.

1. Run `npm install` if dependencies are not installed, then `npm run dev`.
2. Upload `TEST_ERR_original_v9.kicad_mod` and convert it separately to KiCad 7 and KiCad 5.
3. Check that the footprint-level setting is `(solder_paste_ratio -0)`.
4. Open the downloaded files in the corresponding KiCad footprint editor and inspect the geometry and clearance settings.

## Validation recorded for this fix

- `npm run test:fp-paste-ratio` passed. It covers the original fixture; standalone and PCB-embedded footprints; KiCad 9/10 → 8/7/6/5 chains; KiCad 9 token preservation; negative, positive, zero, and negative-zero values; pad overrides; absent overrides; and existing legacy tokens.
- `node scripts/test-fp-unlocked.mjs`, `node scripts/test-k5-pcb-synth.mjs`, and `npm run build` passed.
- Before the fix, both supplied converted files failed to load through KiCad 7.0.5's `pcbnew.FootprintLoad`. After regeneration, both loaded successfully with two pads, six graphic lines, and a footprint paste ratio of `-0.0`.
- KiCad 4/5 compatibility for this token was checked against parser source. No KiCad 4/5 runtime validation is claimed.
- `test-arc-roundtrip.mjs` could not run because the local checkout lacked `asset/kicad6`; it is not part of the paste-ratio regression.
