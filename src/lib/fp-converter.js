/**
 * KiCad Footprint (.kicad_mod) Version Converter
 * 
 * Supports chain-based downgrade conversions for standalone footprint files:
 *   KiCad 10 → KiCad 9
 *   KiCad 9 → KiCad 8
 *   KiCad 8 → KiCad 7
 *   KiCad 7 → KiCad 6
 *   KiCad 6 → KiCad 5  ((footprint ...) → legacy (module ...))
 *   Chained downgrades, e.g. KiCad 10 → KiCad 5 (10→9→8→7→6→5)
 * 
 * Conversion rules (K10 → K9): NF1-NF3
 *   NF1: Header downgrade (version, generator_version)
 *   NF2: Remove (duplicate_pad_numbers_are_jumpers ...) from footprint
 *   NF3: Remove (radius ...) from fp_rect (K10 rounded rect, not supported in K9)
 * 
 * Conversion rules (K9 → K8): F1-F4
 *   F1: Header downgrade (version, generator_version)
 *   F2: Remove (embedded_fonts ...) from footprint
 *   F3: Remove font thickness from Datasheet/Description property effects
 *   F4: Convert (curved_edges yes/no) → (curve_points N) in teardrops
 * 
 * Conversion rules (K8 → K7): F10-F18
 *   F10: Header downgrade (version, remove generator_version, unquote generator)
 *   F11: (uuid "xxx") → (tstamp xxx) everywhere
 *   F12: (property "Reference"/"Value" ...) → (fp_text reference/value ...)
 *   F13: Remove (property "Footprint"/"Datasheet"/"Description" ...) and custom properties
 *   F14: (stroke (width W) (type T)) → (width W) in fp_line/fp_rect/fp_circle/fp_arc/fp_poly
 *   F15: (fill no) → (fill none); handle fill value differences
 *   F16: Pad compatibility — remove_unused_layers, pintype, pinfunction, teardrops
 *   F17: (hide/bold/italic yes) → bare atoms; remove (unlocked yes)
 *   F18: Unquote wildcard layers in pad (layers ...) nodes
 *
 * Conversion rules (K7 → K6): F20-F26
 *   F20: Header downgrade (version → 20211014, remove generator_version, unquote generator)
 *   F21: (stroke (width W) (type T)) → (width W) in fp_line/fp_rect/fp_circle/fp_arc/fp_poly/fp_curve
 *   F22: (fill no) → (fill none) in shapes
 *   F23: Remove (render_cache ...) from fp_text
 *   F24: Remove K7-only objects (fp_text_box, image, net_tie_pad_groups) — lossy
 *   F25: Pad layer-connection attrs: bare flag / removal; remove zone_layer_connections/thermal_bridge_angle
 *   F26: Remove (hide ...) from 3D model nodes
 *
 * Conversion rules (K6 → K5): F30-F38  ((footprint ...) → legacy (module ...))
 *   F30: (footprint ...) → (module ...); drop version/generator; ensure (tedit ...)
 *   F31: (attr ...) → bare smd/virtual (through-hole + sub-flags dropped)
 *   F32: fp_arc 3-point (start/mid/end) → (start=center)(end)(angle)
 *   F33: roundrect/custom pads → rect; strip K6-only pad attributes
 *   F34: fp_rect → four fp_line segments
 *   F35: Remove all (tstamp ...)/(uuid ...)
 *   F36: Drop K6-only children (property/group/net_tie_pad_groups); truncate (path ...) to 8-hex
 *   F37: Strip (fill ...) from graphic shapes (K5 parseEDGE_MODULE rejects any graphic fill)
 *   F38: 3D model (offset (xyz ...)) → (at (xyz ...))
 */

import {
    findChild,
    findChildren,
    removeChild,
    removeAllChildren,
    setChildValue,
    getChildValue,
} from './sexpr-parser.js';

import {
    downgradeArcMidToAngle,
    downgradePadToLegacy,
    rectToLines,
} from './pcb-converter.js';

// --- Version Definitions (Footprint specific) ---

const FP_VERSIONS = {
    KICAD5: { version: '20171130', generatorVersion: null, label: 'KiCad 5' },
    KICAD6: { version: '20211014', generatorVersion: null, label: 'KiCad 6' },
    KICAD7: { version: '20221018', generatorVersion: null, label: 'KiCad 7' },
    KICAD8: { version: '20240108', generatorVersion: '8.0', label: 'KiCad 8' },
    KICAD9: { version: '20241229', generatorVersion: '9.0', label: 'KiCad 9' },
    KICAD10: { version: '20260206', generatorVersion: '10.0', label: 'KiCad 10' },
};

export { FP_VERSIONS };

// ============================================================
//  KiCad 10 → KiCad 9 Conversion (Footprint)
// ============================================================

export async function applyFpK10toK9(ast, log, warnings) {
    const stats = {
        nf1_header: false,
        nf2_duplicate_pad: 0,
        nf3_rounded_rect: 0,
    };

    // NF1: Header downgrade
    setChildValue(ast, 'version', FP_VERSIONS.KICAD9.version);
    const existingGenVer = findChild(ast, 'generator_version');
    if (existingGenVer) {
        setChildValue(ast, 'generator_version', FP_VERSIONS.KICAD9.generatorVersion);
    }
    stats.nf1_header = true;
    log.push(`NF1: Version → ${FP_VERSIONS.KICAD9.version}, generator_version → "${FP_VERSIONS.KICAD9.generatorVersion}"`);

    // NF2: Remove (duplicate_pad_numbers_are_jumpers ...)
    const removed = removeAllChildren(ast, 'duplicate_pad_numbers_are_jumpers');
    if (removed > 0) {
        stats.nf2_duplicate_pad += removed;
        log.push(`NF2: Removed ${removed} (duplicate_pad_numbers_are_jumpers) element(s)`);
    }

    // NF3: Remove (radius ...) from fp_rect — K10 rounded rectangle support
    transformFpK10toK9(ast, stats, log, warnings);

    // Summary
    log.push('--- K10→K9 Footprint Summary ---');
    log.push(`NF1 Header downgraded: ${stats.nf1_header ? 'Yes' : 'No'}`);
    log.push(`NF2 duplicate_pad_numbers_are_jumpers removed: ${stats.nf2_duplicate_pad}`);
    log.push(`NF3 rounded rect radius removed: ${stats.nf3_rounded_rect}`);
}

/**
 * Recursive transformation for K10→K9 Footprint.
 * Handles NF3: Remove (radius ...) from fp_rect nodes.
 */
function transformFpK10toK9(node, stats, log, warnings) {
    if (!node || node.type !== 'list') return;

    // NF3: Remove (radius ...) from fp_rect
    // K10 supports rounded rectangles with (radius N) inside fp_rect;
    // K9 does not recognize this attribute and will error on load.
    if (node.name === 'fp_rect') {
        const removed = removeAllChildren(node, 'radius');
        if (removed > 0) {
            stats.nf3_rounded_rect += removed;
        }
    }

    for (const child of node.children) {
        transformFpK10toK9(child, stats, log, warnings);
    }
}

// ============================================================
//  KiCad 9 → KiCad 8 Conversion (Footprint)
// ============================================================

export async function applyFpK9toK8(ast, log, warnings) {
    const stats = {
        f1_header: false,
        f2_embedded_fonts: 0,
        f3_font_thickness: 0,
        f4_curved_edges: 0,
    };

    // F1: Header downgrade
    setChildValue(ast, 'version', FP_VERSIONS.KICAD8.version);
    // Set or add generator_version
    const existingGenVer = findChild(ast, 'generator_version');
    if (existingGenVer) {
        setChildValue(ast, 'generator_version', FP_VERSIONS.KICAD8.generatorVersion);
    }
    stats.f1_header = true;
    log.push(`F1: Version → ${FP_VERSIONS.KICAD8.version}`);

    // F2: Remove embedded_fonts
    const removedFonts = removeAllChildren(ast, 'embedded_fonts');
    if (removedFonts > 0) {
        stats.f2_embedded_fonts += removedFonts;
        log.push(`F2: Removed ${removedFonts} (embedded_fonts) element(s)`);
    }

    // F3/F4: Recursive transformation
    transformFpK9toK8(ast, stats, log, warnings);

    // Summary
    log.push('--- K9→K8 Footprint Summary ---');
    log.push(`F1 Header downgraded: ${stats.f1_header ? 'Yes' : 'No'}`);
    log.push(`F2 embedded_fonts removed: ${stats.f2_embedded_fonts}`);
    log.push(`F3 Font thickness cleaned: ${stats.f3_font_thickness}`);
    log.push(`F4 curved_edges→curve_points: ${stats.f4_curved_edges}`);
}

function transformFpK9toK8(node, stats, log, warnings) {
    if (!node || node.type !== 'list') return;

    // F3: Remove font thickness from Datasheet/Description property effects
    if (node.name === 'property') {
        const nameChild = node.children[0];
        if (nameChild && (nameChild.value === 'Datasheet' || nameChild.value === 'Description')) {
            const effectsNode = findChild(node, 'effects');
            if (effectsNode) {
                const fontNode = findChild(effectsNode, 'font');
                if (fontNode) {
                    const removed = removeAllChildren(fontNode, 'thickness');
                    if (removed > 0) {
                        stats.f3_font_thickness += removed;
                    }
                }
            }
        }
    }

    // F4: Convert (curved_edges yes/no) → (curve_points N) in teardrops
    if (node.name === 'teardrops') {
        const curvedEdges = findChild(node, 'curved_edges');
        if (curvedEdges) {
            curvedEdges.name = 'curve_points';
        }
        const curvePoints = findChild(node, 'curve_points');
        if (curvePoints && curvePoints.children.length > 0) {
            const val = curvePoints.children[0].value;
            if (val === 'yes' || val === 'no') {
                curvePoints.children[0].value = (val === 'yes') ? '5' : '0';
                stats.f4_curved_edges++;
            }
        }
    }

    for (const child of node.children) {
        transformFpK9toK8(child, stats, log, warnings);
    }
}


// ============================================================
//  KiCad 8 → KiCad 7 Conversion (Footprint)
// ============================================================

export async function applyFpK8toK7(ast, log, warnings) {
    const stats = {
        f10_header: false,
        f11_uuid_to_tstamp: 0,
        f12_property_to_fptext: 0,
        f13_properties_removed: 0,
        f14_stroke_to_width: 0,
        f15_fill_fixed: 0,
        f16_pad_compat: 0,
        f17_syntax_fixed: 0,
        f18_layers_unquoted: 0,
    };

    // F10: Header downgrade
    setChildValue(ast, 'version', FP_VERSIONS.KICAD7.version);
    removeChild(ast, 'generator_version');

    // Unquote generator: change from string to atom
    const generatorNode = findChild(ast, 'generator');
    if (generatorNode && generatorNode.children.length > 0) {
        const genChild = generatorNode.children[0];
        if (genChild.type === 'string') {
            genChild.type = 'atom';
        }
    }
    stats.f10_header = true;
    log.push(`F10: Version → ${FP_VERSIONS.KICAD7.version}, removed generator_version, unquoted generator`);

    // F12/F13: Footprint-level property transformations
    applyFpPropertyConversion(ast, stats, log, warnings);

    // F11, F14-F18: Recursive transformation
    transformFpK8toK7(ast, stats, log, warnings);

    // Summary
    log.push('--- K8→K7 Footprint Summary ---');
    log.push(`F10 Header downgraded: ${stats.f10_header ? 'Yes' : 'No'}`);
    log.push(`F11 uuid→tstamp converted: ${stats.f11_uuid_to_tstamp}`);
    log.push(`F12 property→fp_text converted: ${stats.f12_property_to_fptext}`);
    log.push(`F13 properties removed: ${stats.f13_properties_removed}`);
    log.push(`F14 stroke→width converted: ${stats.f14_stroke_to_width}`);
    log.push(`F15 fill values fixed: ${stats.f15_fill_fixed}`);
    log.push(`F16 pad attributes fixed: ${stats.f16_pad_compat}`);
    log.push(`F17 hide/bold/italic/unlocked fixed: ${stats.f17_syntax_fixed}`);
    log.push(`F18 wildcard layers unquoted: ${stats.f18_layers_unquoted}`);
}

/**
 * F12/F13: Convert footprint-level properties
 *  - property "Reference"/"Value" → fp_text reference/value
 *  - Remove Footprint/Datasheet/Description and custom properties
 */
function applyFpPropertyConversion(fpNode, stats, log, warnings) {
    const propertiesToRemove = [];

    for (let i = fpNode.children.length - 1; i >= 0; i--) {
        const child = fpNode.children[i];
        if (child.type !== 'list' || child.name !== 'property') continue;
        if (child.children.length < 2) continue;

        const propName = child.children[0].value;

        if (propName === 'Reference' || propName === 'Value') {
            // F12: Convert to fp_text
            const propValue = child.children[1]?.value || '';
            const fpTextType = propName === 'Reference' ? 'reference' : 'value';

            const newNode = {
                type: 'list',
                name: 'fp_text',
                children: [
                    { type: 'atom', value: fpTextType },
                    { type: 'string', value: propValue },
                ],
            };

            // Copy remaining children (at, layer, effects, etc.) but skip unlocked and hide
            for (let j = 2; j < child.children.length; j++) {
                const sub = child.children[j];
                if (sub.type === 'list' && sub.name === 'unlocked') continue;
                if (sub.type === 'list' && sub.name === 'hide') continue;
                newNode.children.push(sub);
            }

            fpNode.children[i] = newNode;
            stats.f12_property_to_fptext++;
        } else if (propName === 'Footprint' || propName === 'Datasheet' || propName === 'Description') {
            // F13: Remove standard K8 properties
            propertiesToRemove.push(i);
            stats.f13_properties_removed++;
        } else if (propName !== 'Sheetname' && propName !== 'Sheetfile') {
            // F13 (extended): Remove custom properties not supported in K7
            propertiesToRemove.push(i);
            stats.f13_properties_removed++;
        }
    }

    // Remove marked properties (in reverse order to preserve indices)
    for (const idx of propertiesToRemove) {
        fpNode.children.splice(idx, 1);
    }
}

/**
 * Recursive transformation for K8→K7 Footprint
 */
function transformFpK8toK7(node, stats, log, warnings) {
    if (!node || node.type !== 'list') return;

    // F11: Convert (uuid "xxx") → (tstamp xxx)
    if (node.name === 'uuid') {
        node.name = 'tstamp';
        for (const child of node.children) {
            if (child.type === 'string') {
                child.type = 'atom';
            }
        }
        stats.f11_uuid_to_tstamp++;
    }

    // F14: Convert (stroke (width W) (type T)) → (width W) in graphic elements
    const graphicElements = ['fp_line', 'fp_rect', 'fp_circle', 'fp_arc', 'fp_poly'];
    if (graphicElements.includes(node.name)) {
        const strokeIdx = node.children.findIndex(
            c => c.type === 'list' && c.name === 'stroke'
        );
        if (strokeIdx >= 0) {
            const strokeNode = node.children[strokeIdx];
            const widthNode = findChild(strokeNode, 'width');
            const widthValue = widthNode && widthNode.children.length > 0
                ? widthNode.children[0].value : '0';

            // Replace stroke node with simple (width W)
            node.children.splice(strokeIdx, 1, {
                type: 'list',
                name: 'width',
                children: [{ type: 'atom', value: widthValue }],
            });
            stats.f14_stroke_to_width++;
        }
    }

    // F15: Fix fill values — (fill no) → (fill none)
    if (node.name === 'fill') {
        for (const child of node.children) {
            if (child.type === 'atom' && child.value === 'no') {
                child.value = 'none';
                stats.f15_fill_fixed++;
            }
        }
    }

    // F16: Pad compatibility
    if (node.name === 'pad') {
        applyFpPadCompat(node, stats);
    }

    // F17: Convert (hide yes), (bold yes), (italic yes) list syntax to bare atoms
    if (node.name === 'property' || node.name === 'effects' || node.name === 'font' || node.name === 'model') {
        const keywords = ['hide', 'bold', 'italic'];
        for (const keyword of keywords) {
            const idx = node.children.findIndex(c => c.type === 'list' && c.name === keyword);
            if (idx >= 0) {
                const listNode = node.children[idx];
                const value = listNode.children.length > 0 ? listNode.children[0].value : 'yes';
                node.children.splice(idx, 1);
                if (value === 'yes') {
                    node.children.splice(idx, 0, { type: 'atom', value: keyword });
                }
                stats.f17_syntax_fixed++;
            }
        }
    }

    // F17 (extended): Remove (unlocked yes) from fp_text nodes
    if (node.name === 'fp_text') {
        const unlockedIdx = node.children.findIndex(
            c => c.type === 'list' && c.name === 'unlocked'
        );
        if (unlockedIdx >= 0) {
            node.children.splice(unlockedIdx, 1);
            stats.f17_syntax_fixed++;
        }
    }

    // F18: Unquote wildcard layers — "*.Cu" → *.Cu (string → atom)
    if (node.name === 'layers') {
        for (const child of node.children) {
            if (child.type === 'string' && child.value.startsWith('*.')) {
                child.type = 'atom';
                stats.f18_layers_unquoted++;
            }
        }
    }

    for (const child of node.children) {
        transformFpK8toK7(child, stats, log, warnings);
    }
}

/**
 * F16: Fix pad attributes for K7 compatibility
 * - (remove_unused_layers yes) → bare (remove_unused_layers); remove when "no"
 * - (keep_end_layers yes) → bare (keep_end_layers); remove when "no"
 * - Remove (pintype ...), (pinfunction ...), (teardrops ...)
 */
function applyFpPadCompat(padNode, stats) {
    // Convert list-with-value to bare flag or remove entirely
    const flagAttrs = ['remove_unused_layers', 'keep_end_layers'];
    for (const attrName of flagAttrs) {
        const idx = padNode.children.findIndex(
            c => c.type === 'list' && c.name === attrName
        );
        if (idx >= 0) {
            const attrNode = padNode.children[idx];
            const value = attrNode.children.length > 0 ? attrNode.children[0].value : 'yes';
            if (value === 'yes') {
                attrNode.children = [];
            } else {
                padNode.children.splice(idx, 1);
            }
            stats.f16_pad_compat++;
        }
    }

    // Remove K8-only pad attributes
    const k8OnlyAttrs = ['pintype', 'pinfunction', 'teardrops'];
    for (const attrName of k8OnlyAttrs) {
        for (let i = padNode.children.length - 1; i >= 0; i--) {
            const child = padNode.children[i];
            if (child.type === 'list' && child.name === attrName) {
                padNode.children.splice(i, 1);
                stats.f16_pad_compat++;
            }
        }
    }
}

// ============================================================
//  KiCad 7 → KiCad 6 Conversion (Footprint, F20-series rules)
// ============================================================
//
// KiCad 7 footprints carry the (stroke ...) block on graphics (K6 uses a flat
// (width W)) and add (render_cache ...) to text plus a few K7-only objects.

export async function applyFpK7toK6(ast, log, warnings) {
    const stats = {
        f20_header: false,
        f21_stroke_to_width: 0,
        f22_fill_no_to_none: 0,
        f23_render_cache: 0,
        f24_k7_features: 0,
        f25_pad_attrs: 0,
        f26_model_hide: 0,
    };

    // F20: Header downgrade (K7 footprints have no generator_version; generator is a bare atom)
    setChildValue(ast, 'version', FP_VERSIONS.KICAD6.version);
    removeChild(ast, 'generator_version');
    const generatorNode = findChild(ast, 'generator');
    if (generatorNode && generatorNode.children.length > 0 && generatorNode.children[0].type === 'string') {
        generatorNode.children[0].type = 'atom';
    }
    stats.f20_header = true;
    log.push(`F20: Version → ${FP_VERSIONS.KICAD6.version}, removed generator_version, unquoted generator`);

    // F24: Remove K7-only objects (lossy)
    for (const name of ['fp_text_box', 'image', 'net_tie_pad_groups', 'dimension']) {
        const removed = removeAllChildren(ast, name);
        if (removed > 0) {
            stats.f24_k7_features += removed;
            warnings.push(`Removed ${removed} (${name}) element(s) - KiCad 7 feature not available in KiCad 6`);
        }
    }

    // F24b: Remove property nodes (KiCad 6 footprints do not support properties)
    const removedProperties = removeAllChildren(ast, 'property');
    if (removedProperties > 0) {
        stats.f24_k7_features += removedProperties;
        log.push(`F24b: Removed ${removedProperties} property node(s) from footprint`);
    }

    // F24c: Remove (group ...) nodes from footprint blocks (KiCad 6 does not support footprint-level groups)
    const removedFpGroups = removeAllChildren(ast, 'group');
    if (removedFpGroups > 0) {
        stats.f24_k7_features += removedFpGroups;
        log.push(`F24c: Removed ${removedFpGroups} group node(s) from footprint`);
    }

    transformFpK7toK6(ast, stats, log, warnings);

    // Summary
    log.push('--- K7→K6 Footprint Summary ---');
    log.push(`F20 Header downgraded: ${stats.f20_header ? 'Yes' : 'No'}`);
    log.push(`F21 stroke→width converted: ${stats.f21_stroke_to_width}`);
    log.push(`F22 fill no→none converted: ${stats.f22_fill_no_to_none}`);
    log.push(`F23 render_cache removed: ${stats.f23_render_cache}`);
    log.push(`F24 K7-only objects removed: ${stats.f24_k7_features}`);
    log.push(`F25 pad layer-connection attrs fixed: ${stats.f25_pad_attrs}`);
    log.push(`F26 3D model hide removed: ${stats.f26_model_hide}`);
}

function transformFpK7toK6(node, stats, log, warnings) {
    if (!node || node.type !== 'list') return;

    // F21: (stroke (width W) (type T)) → (width W) in footprint graphics
    const graphicElements = ['fp_line', 'fp_rect', 'fp_circle', 'fp_arc', 'fp_poly', 'fp_curve'];
    if (graphicElements.includes(node.name)) {
        const strokeIdx = node.children.findIndex(c => c.type === 'list' && c.name === 'stroke');
        if (strokeIdx >= 0) {
            const strokeNode = node.children[strokeIdx];
            const widthNode = findChild(strokeNode, 'width');
            if (widthNode && widthNode.children.length > 0 && widthNode.children[0].value !== '') {
                node.children.splice(strokeIdx, 1, {
                    type: 'list', name: 'width',
                    children: [{ type: 'atom', value: widthNode.children[0].value }],
                });
            } else {
                node.children.splice(strokeIdx, 1);
            }
            stats.f21_stroke_to_width++;
        }
    }

    // F22: (fill no) → (fill none) in shapes
    if (['fp_rect', 'fp_circle', 'fp_poly'].includes(node.name)) {
        const fillNode = findChild(node, 'fill');
        if (fillNode && fillNode.children.length > 0) {
            const v = fillNode.children[0];
            if (v.type === 'atom' && v.value === 'no') { v.value = 'none'; stats.f22_fill_no_to_none++; }
        }
    }

    // F23: Remove (render_cache ...) from fp_text
    // Also strip knockout layer attribute (KiCad 6 does not support knockout)
    if (node.name === 'fp_text') {
        const removed = removeAllChildren(node, 'render_cache');
        if (removed > 0) stats.f23_render_cache += removed;

        const layerNode = findChild(node, 'layer');
        if (layerNode && layerNode.children.length > 1) {
            const before = layerNode.children.length;
            layerNode.children = layerNode.children.filter(c => c.value !== 'knockout');
            if (layerNode.children.length < before) {
                stats.f23_render_cache += (before - layerNode.children.length);
            }
        }
    }

    // F25: pad layer-connection attrs — bare flag / removal
    if (node.name === 'pad') {
        for (let i = node.children.length - 1; i >= 0; i--) {
            const child = node.children[i];
            if (child.type !== 'list') continue;
            if (child.name === 'zone_layer_connections') {
                node.children.splice(i, 1); stats.f25_pad_attrs++;
            } else if (child.name === 'remove_unused_layers' || child.name === 'keep_end_layers') {
                const value = child.children.length > 0 ? child.children[0].value : 'yes';
                if (value === 'yes') child.children = [];
                else node.children.splice(i, 1);
                stats.f25_pad_attrs++;
            }
        }
        const removedThermal = removeAllChildren(node, 'thermal_bridge_angle');
        if (removedThermal > 0) stats.f25_pad_attrs += removedThermal;
    }

    // F25b: Remove (footprints ...) from keepout nodes
    if (node.name === 'keepout') {
        const removed = removeAllChildren(node, 'footprints');
        if (removed > 0) stats.f25_pad_attrs += removed;
    }

    // F26: Remove (hide ...) from 3D model nodes
    if (node.name === 'model') {
        const removed = removeAllChildren(node, 'hide');
        if (removed > 0) stats.f26_model_hide += removed;
    }

    // F23b: Remove color and face children from font nodes (KiCad 6 font does not support color or face/custom font)
    if (node.name === 'font') {
        const removedColor = removeAllChildren(node, 'color');
        const removedFace = removeAllChildren(node, 'face');
        if (removedColor > 0 || removedFace > 0) {
            stats.f23_render_cache += (removedColor + removedFace);
        }
    }

    for (const child of node.children) {
        transformFpK7toK6(child, stats, log, warnings);
    }
}

// ============================================================
//  KiCad 6 → KiCad 5 Conversion (Footprint, F30-series rules)
// ============================================================
//
// A standalone KiCad 6 .kicad_mod is a (footprint ...) node carrying (version
// 20211014) + (generator ...) headers. KiCad 5 uses the legacy (module ...) node
// with a (tedit ...) timestamp and no version/generator. Graphics and pads
// downgrade exactly like board footprints (arcs 3-point→center+angle,
// roundrect/custom pads → rect, fp_rect → fp_lines, tstamp/uuid removed). Shared
// geometry/pad helpers are imported from pcb-converter.js.

export async function applyFpK6toK5(ast, log, warnings) {
    const stats = {
        f30_header: false,
        f31_attr: 0,
        f32_arcs: 0,
        f33_pads: 0,
        f34_rects: 0,
        f35_tstamps: 0,
        f36_dropped: 0,
        f37_graphic_fill: 0,
        f38_model_offset: 0,
    };

    // F30: (footprint ...) → (module ...); drop version/generator; ensure (tedit ...)
    ast.name = 'module';
    // Unquote the name only when bare-safe; names with spaces/parens stay quoted
    // (K5 mis-parses an unquoted lib:FOO(DC-10A) — the "(DC-10A)" becomes a token).
    const fpName = ast.children[0];
    if (fpName && (fpName.type === 'string' || fpName.type === 'atom')) {
        fpName.type = /^[^\s()"]+$/.test(String(fpName.value)) ? 'atom' : 'string';
    }
    removeChild(ast, 'version');
    removeChild(ast, 'generator');
    removeChild(ast, 'generator_version');
    if (!findChild(ast, 'tedit')) {
        const layerIdx = ast.children.findIndex(c => c.type === 'list' && c.name === 'layer');
        const tedit = { type: 'list', name: 'tedit', children: [{ type: 'atom', value: '0' }] };
        ast.children.splice(layerIdx >= 0 ? layerIdx + 1 : 1, 0, tedit);
    }
    stats.f30_header = true;
    log.push(`F30: (footprint) → (module), version → ${FP_VERSIONS.KICAD5.version}, removed version/generator`);

    // F31: attr mapping — KiCad 5 only knows bare (attr smd)/(attr virtual);
    // through_hole is the default (no attr) and K6 sub-flags are dropped.
    const attrNode = findChild(ast, 'attr');
    if (attrNode) {
        const flags = attrNode.children.filter(c => c.type === 'atom').map(c => c.value);
        removeChild(ast, 'attr');
        const k5attr = flags.includes('smd') ? 'smd'
            : (flags.includes('virtual') || flags.includes('board_only')) ? 'virtual' : null;
        if (k5attr) {
            ast.children.push({ type: 'list', name: 'attr', children: [{ type: 'atom', value: k5attr }] });
        }
        stats.f31_attr++;
    }

    // F36: drop K6-only footprint children K5 cannot parse; truncate (path ...)
    for (const name of ['property', 'group', 'net_tie_pad_groups']) {
        const r = removeAllChildren(ast, name);
        if (r > 0) stats.f36_dropped += r;
    }
    const pathNode = findChild(ast, 'path');
    if (pathNode && pathNode.children.length > 0 && pathNode.children[0].value) {
        pathNode.children[0].value = '/' + String(pathNode.children[0].value)
            .split('/').filter(Boolean).map(s => s.replace(/-/g, '').slice(-8)).join('/');
        pathNode.children[0].type = 'atom';
    }

    // F32-F34: recursive graphics/pad downgrade
    transformFpK6toK5(ast, stats, log, warnings);

    // F35: remove all tstamp/uuid identifiers (K5 regenerates them on load)
    stats.f35_tstamps += removeDescendantsByNameFp(ast, 'tstamp');
    stats.f35_tstamps += removeDescendantsByNameFp(ast, 'uuid');

    // Summary
    log.push('--- K6→K5 Footprint Summary ---');
    log.push(`F30 Header (footprint→module): ${stats.f30_header ? 'Yes' : 'No'}`);
    log.push(`F31 attr mapped: ${stats.f31_attr}`);
    log.push(`F32 arcs converted to center+angle: ${stats.f32_arcs}`);
    log.push(`F33 roundrect/custom pads → rect: ${stats.f33_pads}`);
    log.push(`F34 rectangles → line segments: ${stats.f34_rects}`);
    log.push(`F35 tstamp/uuid removed: ${stats.f35_tstamps}`);
    log.push(`F36 K6-only children dropped: ${stats.f36_dropped}`);
    log.push(`F37 graphic (fill) removed: ${stats.f37_graphic_fill}`);
    log.push(`F38 model offset → at: ${stats.f38_model_offset}`);
}

function transformFpK6toK5(node, stats, log, warnings) {
    if (!node || node.type !== 'list') return;

    // Unquote simple layer name tokens (KiCad 5 writes them bare)
    if (node.name === 'layer' || node.name === 'layers') {
        for (const c of node.children) {
            if (c.type === 'string' && /^[^\s()"]+$/.test(c.value)) c.type = 'atom';
        }
    }

    // F32: fp_arc 3-point → center+angle
    if (node.name === 'fp_arc') {
        if (downgradeArcMidToAngle(node)) stats.f32_arcs++;
    }
    // F33: pad shape/attribute downgrade
    if (node.name === 'pad') {
        if (downgradePadToLegacy(node)) stats.f33_pads++;
    }
    // F37: Strip (fill ...) from graphic shapes. KiCad 5's parseEDGE_MODULE throws
    // "Expecting 'layer or width'" on a (fill ...) child — it accepts NO fill value
    // (none/solid/yes/no) on fp_line/fp_rect/fp_circle/fp_arc/fp_poly/fp_curve.
    if (['fp_line', 'fp_rect', 'fp_circle', 'fp_arc', 'fp_poly', 'fp_curve'].includes(node.name)) {
        stats.f37_graphic_fill += removeAllChildren(node, 'fill');
    }
    // F38: 3D model (offset (xyz ...)) → (at (xyz ...)) — K5 model node uses 'at'.
    if (node.name === 'model') {
        const offsetNode = findChild(node, 'offset');
        if (offsetNode && !findChild(node, 'at')) {
            offsetNode.name = 'at';
            stats.f38_model_offset++;
        }
    }
    // font color/face removal (defensive; K6 footprint fonts don't carry these)
    if (node.name === 'font') {
        removeAllChildren(node, 'color');
        removeAllChildren(node, 'face');
    }

    // F34: child-level fp_rect → four fp_line segments
    const newChildren = [];
    for (const child of node.children) {
        if (child.type === 'list' && child.name === 'fp_rect') {
            const lines = rectToLines(child);
            if (lines) { newChildren.push(...lines); stats.f34_rects++; continue; }
        }
        newChildren.push(child);
    }
    node.children = newChildren;

    for (const child of node.children) {
        transformFpK6toK5(child, stats, log, warnings);
    }
}

/** Recursively remove all list descendants with the given head name. Returns count. */
function removeDescendantsByNameFp(node, name) {
    if (!node || node.type !== 'list') return 0;
    let removed = 0;
    const before = node.children.length;
    node.children = node.children.filter(c => !(c.type === 'list' && c.name === name));
    removed += before - node.children.length;
    for (const child of node.children) removed += removeDescendantsByNameFp(child, name);
    return removed;
}
