/**
 * KiCad Footprint (.kicad_mod) Version Converter
 * 
 * Supports chain-based downgrade conversions for standalone footprint files:
 *   KiCad 10 → KiCad 9
 *   KiCad 9 → KiCad 8
 *   KiCad 8 → KiCad 7
 *   KiCad 10 → KiCad 7 (chained: 10→9→8→7)
 * 
 * Conversion rules (K10 → K9): NF1-NF2
 *   NF1: Header downgrade (version, generator_version)
 *   NF2: Remove (duplicate_pad_numbers_are_jumpers ...) from footprint
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
 */

import {
    findChild,
    findChildren,
    removeChild,
    removeAllChildren,
    setChildValue,
    getChildValue,
} from './sexpr-parser.js';

// --- Version Definitions (Footprint specific) ---

const FP_VERSIONS = {
    KICAD7: { version: '20211014', generatorVersion: null, label: 'KiCad 7' },
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

    // Summary
    log.push('--- K10→K9 Footprint Summary ---');
    log.push(`NF1 Header downgraded: ${stats.nf1_header ? 'Yes' : 'No'}`);
    log.push(`NF2 duplicate_pad_numbers_are_jumpers removed: ${stats.nf2_duplicate_pad}`);
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
