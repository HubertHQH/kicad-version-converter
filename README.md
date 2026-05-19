# KiCad Multi-Version Converter

A browser-based tool for downgrading KiCad schematic files (`.kicad_sch`), symbol library files (`.kicad_sym`), PCB files (`.kicad_pcb`), and footprint files (`.kicad_mod`) across versions. Supported conversion paths:

- **KiCad 10 → KiCad 9** (schematics / symbol libraries / PCBs / footprints)
- **KiCad 9 → KiCad 8**
- **KiCad 8 → KiCad 7**
- **KiCad 10 → KiCad 7** (chained: 10→9→8→7)
- **KiCad 9 → KiCad 7** (chained: 9→8→7)

## Features

- **Client-side conversion**: Purely front-end implementation — no server required, files are never uploaded anywhere
- **Four file types**: Supports `.kicad_sch` (schematics), `.kicad_sym` (symbol libraries), `.kicad_pcb` (PCBs), and `.kicad_mod` (footprints)
- **Batch processing**: Upload multiple files at once, convert and download as a bundle
- **Auto-detection**: Automatically detects file type and version (KiCad 7/8/9/10) and applies the appropriate conversion rules
- **Chained downgrade**: KiCad 10 → KiCad 7 automatically performs three-step conversion (10→9→8→7)
- **Conversion log**: Displays detailed conversion logs and warning messages

## Conversion Rules

### Schematic (.kicad_sch) — KiCad 10 → KiCad 9 (N1-N10)

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

> ⚠️ **Hierarchical sheets note**: Projects with sub-sheet references must have all `.kicad_sch` files uploaded and converted together. Otherwise, KiCad will report version errors when opening sub-sheets.

### Schematic (.kicad_sch) — KiCad 9 → KiCad 8 (R1-R8)

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

### Schematic (.kicad_sch) — KiCad 8 → KiCad 7 (R10-R15)

| Rule | Description |
|------|-------------|
| R10 | Header downgrade (`version` → `20230121`, remove `generator_version`, unquote `generator`) |
| R11 | Recursively remove `exclude_from_sim` from all nodes |
| R12 | Remove `Description` property from `lib_symbols` symbol definitions |
| R13 | `(hide yes)` → bare `hide`, `(bold yes)` → bare `bold`, `(italic yes)` → bare `italic` in `effects`/`font` |
| R14 | `(fields_autoplaced yes)` → `(fields_autoplaced)` (remove value parameter); remove `(dnp)` node |
| R15 | Auto-convert embedded non-PNG images (e.g. BMP) to PNG using Canvas API (KiCad 7 only supports PNG) |

### Symbol Library (.kicad_sym) — KiCad 10 → KiCad 9 (NS1-NS8)

| Rule | Description |
|------|-------------|
| NS1 | Header version downgrade (`version` → `20241209`, `generator_version` → `9.0`) |
| NS2 | Remove K10-new attributes (`in_pos_files`, `duplicate_pin_numbers_are_jumpers`) |
| NS3 | Remove `show_name` and `do_not_autoplace` from properties |
| NS4 | Move property-level `(hide yes)` into the `effects` node |
| NS6 | `(power global)` → `(power)` (K10 adds `global` parameter; K9 uses bare `power`) |
| NS7 | Remove `(body_styles ...)` nodes from symbols |
| NS8 | Empty pin name `(name "")` → `(name "~")` (K10 uses empty string; K9 uses tilde) |

### Symbol Library (.kicad_sym) — KiCad 9 → KiCad 8 (S1-S4)

| Rule | Description |
|------|-------------|
| S1 | Header version downgrade (`version` → `20231120`, `generator_version` → `8.0`) |
| S2 | `(hide yes)` → bare `hide` in `pin_names` / `pin_numbers` |
| S3 | `(hide yes)` → bare `hide` in `pin` definitions |
| S4 | Remove `(embedded_fonts no)` at the end of each symbol definition |

### Symbol Library (.kicad_sym) — KiCad 8 → KiCad 7 (S10-S14)

| Rule | Description |
|------|-------------|
| S10 | Header downgrade (`version` → `20220914`, remove `generator_version`, unquote `generator`) |
| S11 | Recursively remove `exclude_from_sim` from all symbols |
| S12 | `(property "Description" ...)` → `(property "ki_description" ...)` (property name rename) |
| S13 | `(hide yes)` → bare `hide`, `(bold yes)` → bare `bold`, `(italic yes)` → bare `italic` in `effects`/`font` |
| S14 | Remove `(pin_numbers hide)` node; remove `hide` flag from `pin_names` |

### PCB (.kicad_pcb) — KiCad 10 → KiCad 9 (NP1-NP11)

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

### PCB (.kicad_pcb) — KiCad 9 → KiCad 8 (P1-P9, P21-P23, P27)

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
| P27 | `(solder_paste_margin_ratio ...)` → `(solder_paste_ratio ...)` (K9 rename; K8 uses old name) |

### PCB (.kicad_pcb) — KiCad 8 → KiCad 7 (P10-P28)

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

### Footprint (.kicad_mod) — KiCad 10 → KiCad 9 (NF1-NF2)

| Rule | Description |
|------|-------------|
| NF1 | Header version downgrade (`version` → `20241229`, `generator_version` → `9.0`) |
| NF2 | Remove `(duplicate_pad_numbers_are_jumpers ...)` (K10-new; doesn't exist in K9) |

### Footprint (.kicad_mod) — KiCad 9 → KiCad 8 (F1-F4)

| Rule | Description |
|------|-------------|
| F1 | Header version downgrade (`version` → `20240108`, `generator_version` → `8.0`) |
| F2 | Remove `(embedded_fonts ...)` |
| F3 | Remove `thickness` from Datasheet/Description property fonts |
| F4 | `(curved_edges ...)` → `(curve_points ...)` in pad teardrops (boolean → numeric) |

### Footprint (.kicad_mod) — KiCad 8 → KiCad 7 (F10-F18)

| Rule | Description |
|------|-------------|
| F10 | Header downgrade (`version` → `20211014`, remove `generator_version`, unquote `generator`) |
| F11 | `(uuid "xxx")` → `(tstamp xxx)` (global recursive) |
| F12 | `(property "Reference" ...)` → `(fp_text reference ...)`; `(property "Value" ...)` → `(fp_text value ...)` |
| F13 | Remove `(property "Footprint")`, `(property "Datasheet")`, `(property "Description")` and custom properties |
| F14 | `(stroke (width W) (type T))` → `(width W)` (line width format conversion in graphic elements) |
| F15 | `(fill no)` → `(fill none)` (KiCad 7 doesn't accept `no` value) |
| F16 | Pad attribute compatibility: `(remove_unused_layers yes)` → bare flag / remove when `no`; remove `(pintype)`, `(pinfunction)`, `(teardrops)` |
| F17 | `(hide yes)` → bare `hide`, `(bold yes)` → bare `bold`, `(italic yes)` → bare `italic`; remove `(unlocked yes)` |
| F18 | Unquote pad wildcard layer names: `"*.Cu"` → `*.Cu` (KiCad 7 uses unquoted atoms) |

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Tech Stack

- **React** + **Vite** — Front-end framework and build tool
- **S-expression Parser** — Custom KiCad S-expression parser (`src/lib/sexpr-parser.js`)
- **Converter** — AST-based version conversion engine (`src/lib/converter.js` + `src/lib/sym-converter.js` + `src/lib/pcb-converter.js` + `src/lib/fp-converter.js`), supporting KiCad 10/9/8/7 chained downgrade

## Project Structure

```
converter/
├── src/
│   ├── lib/
│   │   ├── sexpr-parser.js   # S-expression parser and serializer
│   │   ├── converter.js      # Unified conversion entry + schematic conversion rules
│   │   ├── sym-converter.js  # Symbol library conversion rules
│   │   ├── pcb-converter.js  # PCB conversion rules
│   │   └── fp-converter.js   # Footprint conversion rules
│   ├── App.jsx               # Main application component (file upload, conversion, download)
│   └── main.jsx              # Entry point
├── index.html
├── package.json
└── vite.config.js
```

## Sample Files

The `asset/` directory contains sample files for testing and verification:

### Schematic Samples

- **`asset/kicad8/`** — Schematic and PCB files in KiCad 8 format
- **`asset/kicad9/`** — Schematic and PCB files in KiCad 9 format (same designs as kicad8, different version only)

Both folders contain identical design projects (schematic + PCB) for convenient comparison and verification of conversion results:

| Project | Description |
|---------|-------------|
| `complex_hierarchy/` | Complex hierarchical schematic |
| `flat_hierarchy/` | Flat hierarchical schematic |
| `pic_programmer/` | PIC programmer (multi-page schematic) |
| `video/` | Video circuit design |

> **Note**: `kicad9/` also includes a `multichannel/` project that uses KiCad 9's multi-channel feature, which has no corresponding design in KiCad 8.
>
> The `asset/wrongcase/` directory contains test files used to discover and fix edge cases.

### Symbol Library Samples

- **`asset/kicad9/Symbol_v9/`** — KiCad 9 symbol libraries (`.kicad_sym`), 229 library files
- **`asset/kicad8/Symbol_v8/`** — KiCad 8 symbol libraries, 230 library files
- **`asset/kicad7/Symbol_v7/`** — KiCad 7 symbol libraries, 227 library files

All three versions contain the same symbol library content (e.g. `Buffer.kicad_sym`, `power.kicad_sym`, `Device.kicad_sym`, etc.) for cross-version conversion verification.

- **`asset/kicad10/kicad-symbols-10.0.0-rc2/`** — KiCad 10 symbol libraries (`.kicad_symdir` directory format, one file per symbol)

### Footprint Samples

- **`asset/kicad9/kicad-footprints-9.0.7/`** — KiCad 9 official footprint libraries
- **`asset/kicad8/kicad-footprints-v8/`** — KiCad 8 official footprint libraries
- **`asset/kicad7/kicad-footprints-v7/`** — KiCad 7 official footprint libraries

All three versions are KiCad official footprint libraries containing categorized directories such as `Capacitor_SMD.pretty`, `Connector_USB.pretty`, etc., for cross-version conversion verification.

- **`asset/kicad10/kicad-footprints-10.0.0-rc2/`** — KiCad 10 official footprint libraries
