# KiCad Multi-Version Converter

A browser-based tool for **downgrading** KiCad files across versions — schematics (`.kicad_sch`), symbol libraries (`.kicad_sym`), PCBs (`.kicad_pcb`), and footprints (`.kicad_mod`). KiCad only guarantees backward compatibility (a newer KiCad opens older files), never forward compatibility, and there is no official downgrade path — this tool fills that gap by rewriting the file format one major version at a time.

▶ **Try it online: https://www.nextpcb.com/kicad-version-converter**

## Contents

- [Supported Conversions](#supported-conversions)
- [Features](#features)
- [Quick Start](#quick-start)
- [Conversion Rules](#conversion-rules) — [10.99→10](#kicad-1099--kicad-10-nightly--stable) · [Schematic](#schematic-kicad_sch) · [Symbol Library](#symbol-library-kicad_sym) · [PCB](#pcb-kicad_pcb) · [Footprint](#footprint-kicad_mod)
- [Verification](#verification)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Credits](#credits)

## Supported Conversions

Conversion happens **one major version at a time**, and steps are **chained automatically**. Pick any lower target and the tool walks the file down through each intermediate version — e.g. KiCad 10 → KiCad 5 runs `10→9→8→7→6→5`.

| File type | 10.99→10 | 10→9 | 9→8 | 8→7 | 7→6 | 6→5 |
|-----------|:--------:|:----:|:---:|:---:|:---:|:---:|
| **Schematic** `.kicad_sch` | ✅ D1–D4 | ✅ N1–N10 | ✅ R1–R8 | ✅ R10–R15 | ✅ R20–R30 | ✅ → legacy `.sch` + `-cache.lib` |
| **Symbol library** `.kicad_sym` | — | ✅ NS1–NS8 | ✅ S1–S4 | ✅ S10–S14 | ✅ S20–S23 | ✅ → legacy `.lib` + `.dcm` |
| **PCB** `.kicad_pcb` | ✅ DP1–DP7 | ✅ NP1–NP11 | ✅ P1–P9, P21–P23, P27 | ✅ P10–P28 | ✅ P40–P49 | ✅ P50–P64 |
| **Footprint** `.kicad_mod` | — | ✅ NF1–NF2 | ✅ F1–F4 | ✅ F10–F18 | ✅ F20–F26 | ✅ F30–F39 |

Two boundaries are special:

- **KiCad 10.99 → 10** — 10.99 is the development/nightly line (the future KiCad 11) and its format is still changing, so this path is **schematics & PCBs only** and best-effort. Detected files trigger a prominent in-app notice.
- **KiCad 6 → 5** — this crosses KiCad's S-expression / legacy file-family boundary. PCBs and footprints stay S-expression (`(footprint)` → `(module)`), but schematics and symbol libraries are rewritten as **legacy text formats**: `.kicad_sch` → `.sch` (+ a `-cache.lib`), `.kicad_sym` → `.lib` (+ `.dcm`).

### Version stamps per target

Each downgrade rewrites the header `(version …)` (`YYYYMMDD`) and `generator_version`:

| Target | Schematic | Symbol | PCB | Footprint |
|--------|-----------|--------|-----|-----------|
| KiCad 10 | `20260306` | `20251024` | `20260206` | `20260206` |
| KiCad 9 | `20250114` | `20241209` | `20241229` | `20241229` |
| KiCad 8 | `20231120` | `20231120` | `20240108` | `20240108` |
| KiCad 7 | `20230121` | `20220914` | `20221018` | `20221018` |
| KiCad 6 | `20211123` | `20211014` | `20211014` | `20211014` |
| KiCad 5 | legacy `.sch` v4 | legacy `.lib` 2.4 | `20171130` | legacy `(module)` |

## Features

- **Client-side only** — purely front-end; files are parsed and converted in the browser and never uploaded anywhere.
- **Four file types** — `.kicad_sch`, `.kicad_sym`, `.kicad_pcb`, `.kicad_mod`.
- **Auto-detection** — detects file type and version (KiCad 6/7/8/9/10/10.99) and applies the right rules; the target defaults to one major version below the highest file detected.
- **Batch processing** — upload many files at once, convert, and download as a bundle.
- **Chained downgrade** — any multi-step path (e.g. KiCad 10 → KiCad 5) is performed automatically.
- **KiCad 10.99 awareness** — nightly schematics/PCBs are detected (version stamp above stable KiCad 10, or `generator_version "10.99"`) and flagged with a notice that the pre-release format is still changing.
- **Legacy KiCad 5 output** — KiCad 6 schematics/symbol libraries are emitted in the legacy `.sch` and `.lib`/`.dcm` formats; a single input may produce multiple files (e.g. `.sch` + `-cache.lib`).
- **Conversion log** — detailed per-rule logs plus warnings for every lossy step.

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

Then open the dev server URL, drop in your KiCad files, choose a target version, and download the converted output.

## Conversion Rules

Every path is **lossy by design**: features a target version doesn't understand are removed or rewritten to the nearest equivalent, and a warning is logged for each one. The goal is to preserve all core circuit information (connectivity, components, values, positions) while safely dropping or downgrading newer format features. **Always re-open the converted files in the target KiCad to verify them.**

The rule tables below are grouped by file type, newest step first. Click a step to expand its rules.

### KiCad 10.99 → KiCad 10 (nightly → stable)

> 🧪 **KiCad 10.99 is a pre-release/nightly line** (the future KiCad 11). Its file format is still changing, so this path is best-effort and tracks the nightly as it evolves. When a 10.99 file is detected the app shows a prominent notice; always re-open the converted files in KiCad 10 to verify. **Schematics and PCBs only** — 10.99 symbols/footprints are out of scope for now. Detection accepts either a version stamp above stable KiCad 10's or `generator_version "10.99"`.

<details>
<summary><b>Schematic (.kicad_sch)</b> — D1–D4</summary>

| Rule | Description |
|------|-------------|
| D1 | Header → KiCad 10 (`version` → `20260306`, `generator_version` → `10.0`) |
| D2 | Remove native `(ellipse …)` / `(ellipse_arc …)` primitives (10.99 schematic feature) |
| D3 | Remove `(net_chain …)` / `(net_chains …)` (10.99 schematic feature) |
| D4 | Remove `(locked …)` fields (introduced in the 10.99 schematic format) |

</details>

<details>
<summary><b>PCB (.kicad_pcb)</b> — DP1–DP7</summary>

| Rule | Description |
|------|-------------|
| DP1 | Header → KiCad 10 (`version` → `20260206`, `generator_version` → `10.0`) |
| DP2 | Remove 10.99-only board objects/fields: `extruded`, `gr_ellipse`/`fp_ellipse`(`_arc`), `spec_frequency`/`dielectric_model`, `net_chain`/`net_chains`, `thieving` (lossy) |
| DP3 | Remove `(model … (type …))` typed/extruded 3D body blocks (plain file-path models are kept) |
| DP4 | Copper thieving zone fill `(mode thieving)` → `(mode polygon)` |
| DP5 | Remove `(knockout …)` from `table_cell` |
| DP6 | Remove `(sim_electrical_type …)` from `pad` |
| DP7 | **Footprint placement** `(transform (translate X Y) (rotate A) (scale SX SY))` → `(at X Y A)` — KiCad 10.99 replaced `(at …)` with a `transform` block; KiCad 10 has no `transform` token, so an un-converted board fails to load. 3D-model `(scale (xyz …))` / `(rotate (xyz …))` are left untouched; a non-unit scale is dropped with a warning (KiCad 10 cannot scale placed objects) |

</details>

> ⚠️ **Not yet validated against a running KiCad 10** (no public build available to round-trip through). DP1–DP6 follow the AskStr/kicad-backport reference rule set; **DP7 was found from a real 10.99 board failing to load** and is verified byte-for-byte against KiCad's own KiCad 10 demo (the same footprint stored as `(at 110.49 78.867 180)`). The reference's user-layer remap is deliberately **not** applied here — it targets KiCad 5's fixed layer set and would drop the `User.1`–`User.9` / layer display-name fields that KiCad 10 fully supports.

### Schematic (`.kicad_sch`)

> *(KiCad 10.99 → 10 is covered [above](#kicad-1099--kicad-10-nightly--stable).)*

<details>
<summary><b>KiCad 10 → 9</b> — N1–N10</summary>

| Rule | Description |
|------|-------------|
| N1 | Header version downgrade (`version` → `20250114`, `generator_version` → `9.0`) |
| N2 | Remove K10-new attributes from lib_symbol (`in_pos_files`, `duplicate_pin_numbers_are_jumpers`) |
| N3 | Remove `show_name` and `do_not_autoplace` from properties |
| N4 | Move property-level `(hide yes)` into the `effects` node (K10 promotes to property level; K9 keeps it inside effects) |
| N5 | Remove `(body_style ...)` from symbol instances |
| N6 | `(power global)` → `(power)` (K10 adds `global` parameter; K9 uses bare `power`) |
| N7 | Remove `(body_styles ...)` nodes from lib_symbol |
| N8 | Empty pin name `(name "")` → `(name "~")` in lib_symbol (K10 uses empty string; K9 uses tilde) |
| N9 | Remove `(variant ...)` from `(path ...)` (K10 variant feature; not supported in K9) |
| N10 | Remove top-level `(group ...)` (K10 schematic grouping feature; not supported in K9) |

</details>

<details>
<summary><b>KiCad 9 → 8</b> — R1–R8</summary>

| Rule | Description |
|------|-------------|
| R1 | Header version downgrade (`version` → `20231120`, `generator_version` → `8.0`) |
| R2 | `(hide yes)` → bare `hide` in `pin_names` / `pin_numbers` |
| R3 | `(hide yes)` → bare `hide` in `pin` definitions |
| R4 | Remove `embedded_fonts` node |
| R5 | Reposition `uuid` in sheet pins (move after `effects`) |
| R6 | Remove KiCad 9-new sheet attributes (`exclude_from_sim`, `in_bom`, `on_board`, `dnp`) |
| R7 | Remove KiCad 9-only elements (`table`, `rule_area`, `embedded_files`) |
| R8 | Remove `margins` from `text_box` and `exclude_from_sim` from `text`/`text_box` |

</details>

<details>
<summary><b>KiCad 8 → 7</b> — R10–R15</summary>

| Rule | Description |
|------|-------------|
| R10 | Header downgrade (`version` → `20230121`, remove `generator_version`, unquote `generator`) |
| R11 | Recursively remove `exclude_from_sim` from all nodes |
| R12 | Remove `Description` property from `lib_symbols` symbol definitions |
| R13 | `(hide yes)` → bare `hide`, `(bold yes)` → bare `bold`, `(italic yes)` → bare `italic` in `effects`/`font` |
| R14 | `(fields_autoplaced yes)` → `(fields_autoplaced)` (remove value parameter); remove `(dnp)` node |
| R15 | Auto-convert embedded non-PNG images (e.g. BMP) to PNG using Canvas API (KiCad 7 only supports PNG) |

</details>

<details>
<summary><b>KiCad 7 → 6</b> — R20–R30</summary>

| Rule | Description |
|------|-------------|
| R20 | Header downgrade (`version` → `20211123`, remove `generator_version`) |
| R21 | Remove KiCad 7-only features `text_box`/`textbox`, `simulation_model`/`sim_model`, `netclass_flag`/`directive_label`, and root-level graphic drawing primitives `(rectangle)`, `(circle)`, `(polyline)`, `(arc)`, `(bezier)` (lossy) |
| R21b | Remove `(color ...)` from all `(font ...)` nodes (KiCad 6 font does not support custom colors) |
| R22 | Recursively remove `exclude_from_sim` (no simulation exclusion in KiCad 6) |
| R23 | Remove `(dnp ...)` from placed symbols; remove `exclude_from_sim`/`in_bom`/`on_board`/`dnp` from sheets |
| R24 | Remove `(hide ...)` and `(alternate ...)` child lists from lib_symbol pins |
| R25 | Remove placed-symbol pin UUID blocks `(pin "N" (uuid ...))` (KiCad 7-only; not used by KiCad 6 instances) |
| R26 | Add legacy `(id N)` to symbol/sheet properties (KiCad 7 schematic properties omit ids; KiCad 6 requires them). Standard names get fixed ids (Reference 0, Value 1, …); custom fields get ids ≥5 |
| R27 | Normalize sheet property names/ids: `Sheetname` → `"Sheet name"` (id 0), `Sheetfile` → `"Sheet file"` (id 1) |
| R28 | Rebuild the KiCad 6 global `(symbol_instances ...)` + `(sheet_instances ...)` table at the root from the per-object KiCad 7 `(instances (project ...))` blocks |
| R29 | Remove the now-redundant per-object `(instances ...)` blocks |
| R30 | Downgrade `(fill (type color) (color ...))` → `(fill (type background))` (plain `(fill (color ...))` left untouched) |

</details>

#### KiCad 6 → 5 — `.kicad_sch` → `.sch` (legacy crossing)

KiCad 5 schematics use the legacy Eeschema **text** format, not S-expressions, so this is a cross-family rewrite rather than a node-by-node edit. The converter emits:

- `<name>.sch` — `EESchema Schematic File Version 4` header + `$Descr` title block, then `$Comp` components (`L`/`U`/`P`/`F0…Fn` + orientation matrix), `Wire Wire/Bus Line`, `Entry Wire Line`, `Connection`/`NoConn`, `Text Label`/`GLabel`/`HLabel`/`Notes`, and `$Sheet` blocks (sub-sheet `Sheet file` refs are rewritten `.kicad_sch` → `.sch`).
- `<name>-cache.lib` — a legacy symbol library generated from the schematic's embedded `(lib_symbols ...)` so symbols render in KiCad 5 without the original libraries.

**Symbol resolution**: cache symbols are named `nickname_item` (e.g. `video_schlib_S5933_PQ160`) — exactly the key KiCad 5 builds when it falls back to the project cache (`SCH_COMPONENT::Resolve` formats the lib id and replaces `:` with `_`), so a component `L video_schlib:S5933_PQ160 U11` resolves automatically. For a **hierarchical project**, upload all its `.kicad_sch` files together: the converter finds the root sheet and merges every sheet's symbols into one shared `<root>-cache.lib` (KiCad 5 loads a single project cache for the whole hierarchy).

Coordinates convert mm → mil (no axis flip). Component orientation/mirror matrices, symbol arc geometry, and **label orientation** are verified against KiCad's own source and legacy demo output (rotations, mirrors, combined mirror+rotation, pin/arc angles all match). Note the label-orientation quirk handled here: KiCad stores **global/hierarchical** label orientation with `0`↔`2` swapped relative to **local** labels (documented in `sch_legacy_plugin` `loadText`), so directional ports map `{angle 0→2, 90→1, 180→0, 270→3}` while local labels/text use `angle/90` — without this the port pennants point the wrong way.

> ⚠️ **Lossy / limitations**: one sheet per file (designators come from each symbol's `Reference` property; cross-sheet instance `AR` tables are not synthesized, so deep hierarchies may need re-annotation); hierarchical sheet *pins* (sheet ports) use a best-effort side mapping. Verify before use.

> ⚠️ **Hierarchical sheets**: projects with sub-sheet references must have all `.kicad_sch` files uploaded and converted together — otherwise KiCad reports version errors when opening sub-sheets. For KiCad 7 → 6, the KiCad 6 instance table is reconstructed heuristically from KiCad 7 hierarchy paths (reference designators are also preserved in each symbol's `Reference` property), so deeply nested projects should be re-opened in KiCad 6 to confirm the result.

### Symbol Library (`.kicad_sym`)

<details>
<summary><b>KiCad 10 → 9</b> — NS1–NS8</summary>

| Rule | Description |
|------|-------------|
| NS1 | Header version downgrade (`version` → `20241209`, `generator_version` → `9.0`) |
| NS2 | Remove K10-new attributes (`in_pos_files`, `duplicate_pin_numbers_are_jumpers`) |
| NS3 | Remove `show_name` and `do_not_autoplace` from properties |
| NS4 | Move property-level `(hide yes)` into the `effects` node |
| NS6 | `(power global)` → `(power)` (K10 adds `global` parameter; K9 uses bare `power`) |
| NS7 | Remove `(body_styles ...)` nodes from symbols |
| NS8 | Empty pin name `(name "")` → `(name "~")` (K10 uses empty string; K9 uses tilde) |

</details>

<details>
<summary><b>KiCad 9 → 8</b> — S1–S4</summary>

| Rule | Description |
|------|-------------|
| S1 | Header version downgrade (`version` → `20231120`, `generator_version` → `8.0`) |
| S2 | `(hide yes)` → bare `hide` in `pin_names` / `pin_numbers` |
| S3 | `(hide yes)` → bare `hide` in `pin` definitions |
| S4 | Remove `(embedded_fonts no)` at the end of each symbol definition |

</details>

<details>
<summary><b>KiCad 8 → 7</b> — S10–S14</summary>

| Rule | Description |
|------|-------------|
| S10 | Header downgrade (`version` → `20220914`, remove `generator_version`, unquote `generator`) |
| S11 | Recursively remove `exclude_from_sim` from all symbols |
| S12 | `(property "Description" ...)` → `(property "ki_description" ...)` (property name rename) |
| S13 | `(hide yes)` → bare `hide`, `(bold yes)` → bare `bold`, `(italic yes)` → bare `italic` in `effects`/`font` |
| S14 | Remove `(pin_numbers hide)` node; remove `hide` flag from `pin_names` |

</details>

<details>
<summary><b>KiCad 7 → 6</b> — S20–S23</summary>

| Rule | Description |
|------|-------------|
| S20 | Header downgrade (`version` → `20211014`, remove `generator_version`) |
| S21 | Remove symbol text boxes (`text_box`/`textbox`) — KiCad 7 feature (lossy) |
| S22 | Remove `(hide ...)` and `(alternate ...)` child lists from pins |
| S23 | Downgrade `(fill (type color) (color ...))` → `(fill (type background))` |

</details>

#### KiCad 6 → 5 — `.kicad_sym` → `.lib` + `.dcm` (legacy crossing)

KiCad 5 symbol libraries use the legacy `.lib` (2.4) + `.dcm` (2.0) **text** formats. The converter emits:

- `<name>.lib` — `EESchema-LIBRARY Version 2.4` with one `DEF … ENDDEF` per symbol: `F0–F3` standard fields + custom `F4+`, `ALIAS` lines for derived (`extends`) symbols, `$FPLIST` from `ki_fp_filters`, and a `DRAW` section (`S` rectangle, `C` circle, `P` polyline, `A` arc, `T` text, `X` pins).
- `<name>.dcm` — `$CMP`/`D`/`K`/`F` records from `ki_description`/`ki_keywords`/`Datasheet` (only when present).

Coordinates convert mm → mil (symbols are Y-up in both formats; no flip). Pin electrical types/shapes, hide flags, power symbols (`P` flag), multi-unit (`_unit_style`) layout, and `extends` → `ALIAS` are mapped.

> ⚠️ **Lossy / limitations**: a derived symbol with its own graphics keeps only the base graphics (legacy `ALIAS` limitation). Output is **not validated against a real KiCad 5**.

### PCB (`.kicad_pcb`)

> *(KiCad 10.99 → 10 is covered [above](#kicad-1099--kicad-10-nightly--stable).)*

<details>
<summary><b>KiCad 10 → 9</b> — NP1–NP11</summary>

| Rule | Description |
|------|-------------|
| NP1 | Header version downgrade (`version` → `20241229`, `generator_version` → `9.0`) |
| NP2 | Convert `tenting` from nested to compact format: `(tenting (front yes) (back yes))` → `(tenting front back)` |
| NP3 | Remove K10 via-hole processing attributes from setup (`covering`, `plugging`, `capping`, `filling`) |
| NP4 | Restore K9 pcbplotparams (`hpglpennumber`, `hpglpenspeed`, `hpglpendiameter`, `plotinvisibletext`); fix float formats |
| NP5 | Collect all net names from `segment`/`arc`/`via`/`zone`/`pad`/`gr_rect`/`gr_arc`/`gr_line`/`gr_poly`/`gr_circle`, assign IDs, insert `(net ID "name")` declaration block after setup |
| NP6 | Convert net references: name→ID. `segment`/`arc`/`via`/`gr_rect`/`gr_arc`/`gr_line`/`gr_poly`/`gr_circle`: `(net "name")` → `(net ID)`; `pad`: `(net "name")` → `(net ID "name")`; `zone`: `(net "name")` → `(net ID)` + add `(net_name "name")` |
| NP7 | Remove `capping`/`covering`/`plugging`/`filling` attributes from vias |
| NP8 | Zone fill fixes: remove `(island_removal_mode ...)`, remove `(island ...)` from `filled_polygon`, add `(filled_areas_thickness no)` |
| NP9 | Remove K10-only footprint-level attributes (`units`, `duplicate_pad_numbers_are_jumpers`, `point`, `component_classes`) |
| NP10 | Restore `(unlocked yes)` and font `(thickness 0.15)` on Datasheet/Description properties in footprints |
| NP11 | Remove `(radius ...)` from `gr_rect`/`fp_rect` (K10 rounded rectangle feature; not supported in K9) |

</details>

<details>
<summary><b>KiCad 9 → 8</b> — P1–P9, P21–P23, P27</summary>

| Rule | Description |
|------|-------------|
| P1 | Header version downgrade (`version` → `20240108`, `generator_version` → `8.0`) |
| P2 | Layer ID mapping: KiCad 9 new numbering scheme → KiCad 8 legacy numbering (0-49) |
| P3 | `layerselection` bitmask format: 128-bit → compact format |
| P4 | Remove `(tenting ...)`, add `(viasonmask no)` to `pcbplotparams` |
| P5 | Remove `(embedded_fonts ...)` — top-level and inside footprints |
| P6 | Remove K9-new pcbplotparams (`pdf_metadata`, `plotpadnumbers`, `hidednponfab`, etc.) |
| P7 | Restore K8 pcbplotparams (`plotreference`, `plotvalue`, `plotfptext`) |
| P8 | Remove K9-only top-level elements (`embedded_files`, `component_class`) |
| P9 | Remove `thickness` from Datasheet/Description property fonts |
| P21 | Remove `(arrow_direction ...)` from dimension style, `(keep_text_aligned yes)` → bare atom; `(suppress_zeroes yes)` → bare atom in dimension format |
| P22 | Remove `(placement ...)` from zones (KiCad 9 multi-channel auto-placement area; not supported in K8) |
| P23 | `(curved_edges ...)` → `(curve_points ...)` in pad teardrops (K9 rename; K8 uses old name) |
| P27 | Footprint-level `(solder_paste_margin_ratio ...)` → `(solder_paste_ratio ...)` (K9 rename); preserve pad-level `solder_paste_margin_ratio` and all numeric values |

</details>

<details>
<summary><b>KiCad 8 → 7</b> — P10–P28</summary>

| Rule | Description |
|------|-------------|
| P10 | Header downgrade (`version` → `20221018`, remove `generator_version`, unquote `generator`) |
| P11 | `(uuid "xxx")` → `(tstamp xxx)` (global recursive) |
| P12 | `(property "Reference" ...)` → `(fp_text reference ...)` |
| P13 | `(property "Value" ...)` → `(fp_text value ...)` |
| P14 | Remove all footprint properties unsupported by K7 (`Footprint`/`Datasheet`/`Description` and custom properties like `Champ4`) |
| P15 | `(sheetname ...)`/`(sheetfile ...)` → `(property "Sheetname"/"Sheetfile" ...)` |
| P16 | `(locked yes)` child node → bare `locked` atom on the footprint definition line |
| P17 | Remove `(legacy_teardrops ...)` from `general` |
| P18 | Remove `(allow_soldermask_bridges_in_footprints ...)` from `setup` |
| P19 | Boolean values `yes/no` → `true/false` in `pcbplotparams` |
| P20 | Remove K8-new pcbplotparams (`pdf_front/back_fp_property_popups`, `plotfptext`) |
| P21 | Pad/via attribute compatibility: `(remove_unused_layers yes)` → bare flag / remove when `no`; `(keep_end_layers ...)` likewise; remove `(pintype ...)`, `(pinfunction ...)`, `(teardrops ...)`, `(free yes)`, `(zone_layer_connections ...)` |
| P21b | `(hide yes)` → bare `hide`, `(bold yes)` → bare `bold`, `(italic yes)` → bare `italic` in property/effects/font/model |
| P22 | Graphic element fill: `(fill no)` → `(fill none)` (KiCad 7 only accepts `yes`/`none`/`solid`, not `no`) |
| P23 | Remove `(unlocked yes)` from `fp_text` (not supported in KiCad 7) |
| P24 | Remove `(net ...)` from top-level graphic elements (`gr_line`/`gr_circle`/`gr_arc`, etc.) (KiCad 7 doesn't support net assignment on graphics) |
| P25 | Remove `(locked yes)` from top-level graphic elements (`gr_text`/`gr_line`, etc.) (not supported in KiCad 7) |
| P26 | `group` nodes: `(uuid ...)` → `(id ...)`, remove `(locked yes)` (KiCad 7 groups use `id` instead of `tstamp`) |
| P27 | Remove K8-only flags from footprint `(attr ...)` (`dnp`, `allow_missing_courtyard`) |
| P28 | Remove top-level `(generated ...)` elements (tuning patterns and other KiCad 8-only features; not supported in K7) |

</details>

<details>
<summary><b>KiCad 7 → 6</b> — P40–P49</summary>

| Rule | Description |
|------|-------------|
| P40 | Header downgrade (`version` → `20211014`, remove `generator_version`, unquote `generator`) |
| P41 | Remove KiCad 7-only features: `gr_text_box`/`fp_text_box`/`text_box`, `image`, `net_tie`/`net_ties`/`net_tie_pad_groups` (lossy) |
| P41b | Move footprint-level `(dimension ...)` nodes to the root PCB level (KiCad 6 does not support dimensions inside footprints) |
| P42 | `(stroke (width W) (type T))` → `(width W)` in all `gr_*`/`fp_*` graphic shapes (KiCad 6 uses flat width) |
| P43 | `pcbplotparams` booleans `yes`/`no` → `true`/`false` |
| P44 | `(fill no)` → `(fill none)` in graphic shapes |
| P45 | Remove `(render_cache ...)` from `gr_text`/`fp_text` |
| P46 | Via layer-connection attrs: `(remove_unused_layers yes)`/`(keep_end_layers yes)` → bare flag (removed when `no`); remove `(zone_layer_connections ...)` and `(free ...)` |
| P47 | Remove `(thermal_bridge_angle ...)` from pads/zones; remove `(attr ...)` from zones |
| P48 | Dimension downgrade: `(type radial)` → `(type leader)` and remove the radial-only `(leader_length ...)`; also remove `(arrow_direction ...)` from dimension style |
| P49 | Remove `(hide ...)` from 3D `model` nodes |

</details>

<details>
<summary><b>KiCad 6 → 5</b> — P50–P64</summary>

| Rule | Description |
|------|-------------|
| P50 | Header downgrade: `version` → `20171130`; rewrite K6 `(generator pcbnew)` → KiCad 5's `(host pcbnew "(5.1.5)")` (the K5 board parser requires the 3-token `(host app version)` form and rejects `(generator …)`); `(paper …)` → `(page …)` (K5 only knows the `page` token) |
| P51 | Layers block: drop the KiCad 6 descriptive 3rd field, unquote layer names, map renamed user layers (`User.Drawings` → `Dwgs.User`), and **remove KiCad 6 user layers with no KiCad 5 slot** — `User.1`–`User.9` (layer IDs 50-58); K5's layer set is fixed at IDs 0-49, so it otherwise rejects the board with *"Layer … is not in fixed layer hash"* |
| P51b | Remap object `(layer …)` references that named a removed layer → `Dwgs.User`, **preserving pad layer-set wildcards** `*.Cu`/`*.Mask`/`F&B.Cu` |
| P52 | Remove `(stackup ...)` from `setup` (board stackup is KiCad 6+) |
| P53 | `(footprint ...)` → `(module ...)`: unquote the name **only when bare-safe** (names with spaces/parens stay quoted — an unquoted `lib:FOO(DC-10A)` makes K5 read `(DC-10A)` as a child token and fail), map `(attr ...)` to bare `smd`/`virtual` (else dropped), drop `property`/`group`/`net_tie_pad_groups`, truncate `(path ...)` UUIDs to 8-hex |
| P54 | Graphic arcs (`gr_arc`/`fp_arc`) 3-point `(start)(mid)(end)` → legacy `(start=center)(end)(angle)` |
| P55 | `roundrect`/`custom` pads → `rect`; drop `roundrect_rratio`/`chamfer`/`options`/`primitives`, `pinfunction`/`pintype`, `zone_layer_connections`/`remove_unused_layers` |
| P56 | Zones: remove `filled_areas_thickness`/`name`/`attr`; drop keepout zones; split multilayer zones into one zone per layer; clean `filled_polygon` (`layer`/`island`) |
| P57 | `gr_rect`/`fp_rect` → four line segments (KiCad 5 has no rectangle primitive) |
| P58 | Curved track `(arc ...)` → straight `(segment ...)` approximation (lossy) |
| P59 | Remove KiCad 6-only via attrs (`free`, `remove_unused_layers`, `zone_layer_connections`) |
| P60 | Remove all `(tstamp ...)`/`(uuid ...)` identifiers (KiCad 5 regenerates 8-hex stamps; net-based connectivity is preserved) |
| P61 | Drop K6 parametric `(dimension …)` objects — K5 needs explicit feature/arrow geometry; lossy, with warning |
| P62 | 3D model `(offset (xyz …))` → `(at (xyz …))` (K5 `model` node uses `at`) |
| P63 | Strip `(fill …)` from graphic shapes (`gr_poly`/`fp_poly`/`gr_circle`/…) — K5's graphic parser rejects it; zone fill is left intact |
| P64 | Remove `(group …)` nodes — KiCad 6 object grouping (board-level + nested); K5 has no groups (*"Unknown token group"*). Grouped objects survive, ungrouped |

</details>

> ⚠️ **Radial dimension note (lossy)** — KiCad 6 has no radial dimension type. P48 rewrites `(type radial)` to the closest analog, a `leader` dimension (leader line + text), preserving the text/format (including `override_value`) and dropping the radial-only `leader_length`. The annotation survives but its semantics degrade from a true radial/diameter measurement to a plain leader callout (a warning is emitted per dimension). An un-downgraded `(type radial)` would make the whole KiCad 6 board fail to load. These dimensions often live *inside* footprints in KiCad 7; P41b first lifts them to the board root, then P48 downgrades the type.

> 📝 **K6→K5 note** — K6-only `pcbplotparams` (`dxf…`, `svg…`, `dashed_line_*`, `sketchpadsonfab`, `disableapertmacros`, …) are left as-is; KiCad 5's `pcbplotparams` sub-parser silently skips unknown tokens (verified against the 5.1 source).

> ✅ **K6→K5 validated against a real KiCad 5** — rules were derived/checked by diffing the regenerated board against KiCad's own `5.1/demos/video/video.kicad_pcb` per node type, and against the 5.1 `PCB_PARSER` source (strict main parser vs. lenient `pcbplotparams`). Real boards then surfaced a cascade of load errors this also fixed — the `(host …)` header, `(paper)`→`(page)`, `User.1`–`User.9` layer removal, graphic `(fill …)`, model `(offset)`→`(at)`, board-level `(group …)`, footprint-name-with-parens quoting, and a `rectToLines` width-coercion bug (`[object Object]`). The most reliable check is a **whole-board grammar audit** (every top-level node type and every `(module …)` child against KiCad 5's accepted token sets), so the converter is checked structurally, not just one error at a time. Remaining lossy item: dropped parametric dimensions (P61).

### Footprint (`.kicad_mod`)

<details>
<summary><b>KiCad 10 → 9</b> — NF1–NF2</summary>

| Rule | Description |
|------|-------------|
| NF1 | Header version downgrade (`version` → `20241229`, `generator_version` → `9.0`) |
| NF2 | Remove `(duplicate_pad_numbers_are_jumpers ...)` (K10-new; doesn't exist in K9) |

</details>

<details>
<summary><b>KiCad 9 → 8</b> — F1–F5</summary>

| Rule | Description |
|------|-------------|
| F1 | Header version downgrade (`version` → `20240108`, `generator_version` → `8.0`) |
| F2 | Remove `(embedded_fonts ...)` |
| F3 | Remove `thickness` from Datasheet/Description property fonts |
| F4 | `(curved_edges ...)` → `(curve_points ...)` in pad teardrops (boolean → numeric) |
| F5 | Footprint-level `(solder_paste_margin_ratio ...)` → `(solder_paste_ratio ...)`; preserve the value (including `-0`) and pad-level `solder_paste_margin_ratio`. Applies to chained downgrades through KiCad 5 |

</details>

<details>
<summary><b>KiCad 8 → 7</b> — F10–F18</summary>

| Rule | Description |
|------|-------------|
| F10 | Header downgrade (`version` → `20221018`, remove `generator_version`, unquote `generator`) |
| F11 | `(uuid "xxx")` → `(tstamp xxx)` (global recursive) |
| F12 | `(property "Reference" ...)` → `(fp_text reference ...)`; `(property "Value" ...)` → `(fp_text value ...)` |
| F13 | Remove `(property "Footprint")`, `(property "Datasheet")`, `(property "Description")` and custom properties |
| F14 | `(stroke (width W) (type T))` → `(width W)` (line width format conversion in graphic elements) |
| F15 | `(fill no)` → `(fill none)` (KiCad 7 doesn't accept `no` value) |
| F16 | Pad attribute compatibility: `(remove_unused_layers yes)` → bare flag / remove when `no`; remove `(pintype)`, `(pinfunction)`, `(teardrops)` |
| F17 | `(hide yes)` → bare `hide`, `(bold yes)` → bare `bold`, `(italic yes)` → bare `italic`; remove `(unlocked yes)` |
| F18 | Unquote pad wildcard layer names: `"*.Cu"` → `*.Cu` (KiCad 7 uses unquoted atoms) |

</details>

<details>
<summary><b>KiCad 7 → 6</b> — F20–F26</summary>

| Rule | Description |
|------|-------------|
| F20 | Header downgrade (`version` → `20211014`, remove `generator_version`, unquote `generator`) |
| F21 | `(stroke (width W) (type T))` → `(width W)` in `fp_line`/`fp_rect`/`fp_circle`/`fp_arc`/`fp_poly`/`fp_curve` |
| F22 | `(fill no)` → `(fill none)` in shapes |
| F23 | Remove `(render_cache ...)` from `fp_text` |
| F24 | Remove KiCad 7-only objects (`fp_text_box`, `image`, `net_tie_pad_groups`) — lossy |
| F25 | Pad layer-connection attrs: `(remove_unused_layers yes)`/`(keep_end_layers yes)` → bare flag (removed when `no`); remove `(zone_layer_connections ...)` and `(thermal_bridge_angle ...)` |
| F26 | Remove `(hide ...)` from 3D `model` nodes |

</details>

<details>
<summary><b>KiCad 6 → 5</b> — F30–F39</summary>

| Rule | Description |
|------|-------------|
| F30 | `(footprint ...)` → `(module ...)`: drop `version`/`generator`, unquote the name **only when bare-safe** (names with spaces/parens stay quoted), ensure a `(tedit ...)` timestamp |
| F31 | Map `(attr ...)` to bare `smd`/`virtual` (through-hole + sub-flags dropped) |
| F32 | `fp_arc` 3-point `(start)(mid)(end)` → `(start=center)(end)(angle)` |
| F33 | `roundrect`/`custom` pads → `rect`; strip KiCad 6-only pad attributes |
| F34 | `fp_rect` → four `fp_line` segments |
| F35 | Remove all `(tstamp ...)`/`(uuid ...)` |
| F36 | Drop KiCad 6-only children (`property`/`group`/`net_tie_pad_groups`); truncate `(path ...)` to 8-hex |
| F37 | Strip `(fill …)` from graphic shapes — KiCad 5's `parseEDGE_MODULE` rejects any graphic fill (not just `(fill no)`) |
| F38 | 3D model `(offset (xyz …))` → `(at (xyz …))` (K5 `model` node uses `at`) |
| F39 | Remove bare `unlocked` from `fp_text` `(at …)` so KiCad 4 can open the KiCad 5 footprint |

</details>

> 📝 **Footprint version stamps** — KiCad 7 footprints use `20221018`, KiCad 6 use `20211014`. The bundled KiCad 6 test footprints are already in legacy `(module)` form, so the K6→K5 path is exercised by chained conversions from KiCad 7–10 footprints.

## Verification

Run `npm run test:fp-paste-ratio` for the `bug/TEST_ERR_original_v9.kicad_mod` regression and footprint/pad paste-ratio checks across standalone and PCB conversions (KiCad 9/10 → 8/7/6/5). The fix restores the pre-K9 **footprint-level** `solder_paste_ratio` token while preserving **pad-level** `solder_paste_margin_ratio` and numeric values, including `-0`. See [the regression notes](bug/README.md) for reproduction steps and corrected files.

Both corrected paste-ratio fixtures (KiCad 7 and KiCad 5 output) were loaded successfully by **KiCad 7.0.5's native footprint loader**, preserving two pads, six graphic lines, and the ratio value. KiCad 4/5 token compatibility was checked against their parser source; these fixtures have not been tested in a KiCad 4/5 runtime.

KiCad 6 → KiCad 5 schematic and symbol conversions cross a file-family boundary. Broader conversion checks use AST re-parsing, version stamps, and KiCad's **own source and demo projects**:

- **PCB / footprint** — rules derived by diffing the regenerated board/footprint against KiCad's own `5.1/demos/video/video.kicad_pcb` per node type, and cross-checked with the 5.1 `PCB_PARSER` source (strict main parser vs. lenient `pcbplotparams`). This caught the `(host …)` header, `(paper)`→`(page)`, `User.1`–`User.9` layer removal, graphic-`fill`, model `offset`→`at`, board-level `(group)`, footprint-name-with-parens quoting, and dimension issues. A **whole-board grammar audit** (top-level node types + every `(module)` child vs. KiCad 5's accepted token sets) finds remaining issues structurally rather than one load-error round-trip at a time. `test-k5-pcb-synth.mjs` locks in every PCB rule without needing the (gitignored) asset fixtures.
- **Schematic / symbol** — component orientation/mirror matrices, symbol arcs, and label orientation verified against KiCad 6/5.1 source (`sch_symbol.cpp`, `sch_sexpr_parser.cpp`, `sch_legacy_plugin.cpp`) and the matching legacy demo sheets; cache symbol naming verified against `SCH_COMPONENT::Resolve`.

Run all harnesses (`node scripts/<file>`):

```bash
for t in test-k1099-k10 test-k6k5 test-k5-pcb-synth check-k5-header test-cache-match test-consolidate test-orient test-arc-roundtrip test-label-orient test-fp-unlocked test-fp-paste-ratio; do node scripts/$t.mjs; done
```

Some harnesses require the gitignored `asset/` fixtures; for example, `test-arc-roundtrip.mjs` cannot run without `asset/kicad6`. The paste-ratio regression uses the committed `bug/` fixture and synthetic inputs.

> Still best-effort (no KiCad-5 ground truth available): hierarchical **sheet-pin** side letters, dropped PCB parametric **dimensions** (removed, not redrawn), and the entire **KiCad 10.99 → 10** path (no public KiCad 10 build to round-trip through; DP7 is verified against KiCad's own KiCad 10 demo).

## Tech Stack

- **React** + **Vite** — front-end framework and build tool
- **S-expression parser** — custom KiCad S-expression parser/serializer (`src/lib/sexpr-parser.js`)
- **AST-based converters** — `converter.js` (schematic) + `sym-converter.js` (symbol) + `pcb-converter.js` (PCB) + `fp-converter.js` (footprint), supporting the KiCad 10.99/10/9/8/7/6 chained downgrade
- **Legacy writers** — KiCad 5 cross-family text emitters: `sch-legacy-writer.js` (`.kicad_sch` → `.sch` + cache) and `sym-legacy-writer.js` (`.kicad_sym` → `.lib`/`.dcm`)

## Project Structure

```
converter/
├── src/
│   ├── lib/
│   │   ├── sexpr-parser.js       # S-expression parser and serializer
│   │   ├── converter.js          # Unified conversion entry + schematic rules
│   │   ├── sym-converter.js      # Symbol library rules (S-expression, K10→K6)
│   │   ├── pcb-converter.js      # PCB rules (incl. K6→K5)
│   │   ├── fp-converter.js       # Footprint rules (incl. K6→K5)
│   │   ├── sch-legacy-writer.js  # KiCad 6 → 5 legacy .sch writer (+ cache .lib)
│   │   └── sym-legacy-writer.js  # KiCad 6 → 5 legacy .lib/.dcm writer
│   ├── App.jsx                   # Main UI (upload, convert, download, 10.99 banner)
│   └── main.jsx                  # Entry point
├── scripts/                      # Verification harnesses (run with `node scripts/<file>`)
│   ├── test-fp-paste-ratio.mjs   # footprint/pad paste ratio scope, real fixture + K9/K10 downgrade chains
│   ├── test-fp-unlocked.mjs      # remove unlocked text placement flags only from K5 output
│   ├── test-k1099-k10.mjs        # KiCad 10.99 → 10 schematic + PCB rules (D1-D4, DP1-DP7) + detection
│   ├── test-k6k5.mjs             # end-to-end: all 4 file types convert, re-parse, right stamps, value checks
│   ├── test-k5-pcb-synth.mjs     # self-contained synthetic K6 board exercising every K5 PCB rule (P50-P64)
│   ├── check-k5-header.mjs       # emulates KiCad 5 PCB_PARSER::parseHeader (catches the (host …) issue)
│   ├── test-cache-match.mjs      # every schematic L lib_id resolves to a cache DEF/ALIAS
│   ├── test-consolidate.mjs      # hierarchical project → one shared <root>-cache.lib
│   ├── test-orient.mjs           # component matrices vs KiCad's exact orientation/mirror formula
│   ├── test-arc-roundtrip.mjs    # symbol arc angles ↔ endpoints self-consistent
│   └── test-label-orient.mjs     # label orientation vs KiCad 5 demo ground truth
├── bug/                          # paste-ratio regression notes, K9 input, corrected K7/K5 output
├── index.html
├── package.json
└── vite.config.js
```

## Credits

Some of the version-downgrade rule sets — in particular the **KiCad 10.99 → 10** backport rules — were informed by [**AskStr/kicad-backport-cplus**](https://github.com/AskStr/kicad-backport-cplus). Thanks to that project for the reference.

Where this converter deviates from it, the differences are noted inline in the [Conversion Rules](#conversion-rules) — e.g. KiCad 10's `User.1`–`User.9` layers are kept rather than remapped to KiCad 5's fixed layer set, and DP7 (`transform` → `at`) was added from a real KiCad 10.99 board that failed to load.
