/**
 * KiCad Symbol Library (.kicad_sym) Version Converter
 * 
 * Supports chain-based downgrade conversions for symbol libraries:
 *   KiCad 10 → KiCad 9
 *   KiCad 9 → KiCad 8
 *   KiCad 8 → KiCad 7
 *   KiCad 7 → KiCad 6
 *   Chained downgrades, e.g. KiCad 10 → KiCad 6 (10→9→8→7→6)
 * 
 * Conversion rules (K10 → K9):
 *   NS1: Header version/generator downgrade
 *   NS2: Remove K10-only attrs (in_pos_files, duplicate_pin_numbers_are_jumpers)
 *   NS3: Remove show_name/do_not_autoplace from properties
 *   NS4: Move property-level (hide yes) into effects
 *   NS6: Convert (power global) → (power)
 *   NS7: Remove body_styles from symbols
 *   NS8: Convert empty pin names to tilde
 * 
 * Conversion rules (K9 → K8):
 *   S1: Header version/generator downgrade
 *   S2: pin_names/pin_numbers hide syntax: (hide yes) → bare hide
 *   S3: pin hide syntax: (hide yes) → bare hide
 *   S4: Remove embedded_fonts from each symbol
 * 
 * Conversion rules (K8 → K7):
 *   S10: Header downgrade (version, remove generator_version, unquote generator)
 *   S11: Remove exclude_from_sim from all symbols
 *   S12: Rename (property "Description" ...) → (property "ki_description" ...)
 *   S13: Convert (hide/bold/italic yes) to bare atoms in effects/font
 *   S14: Handle pin_numbers/pin_names hide differences for K7
 *
 * Conversion rules (K7 → K6):
 *   S20: Header downgrade (version → 20211014, remove generator_version)
 *   S21: Remove symbol text boxes (text_box/textbox) — K7 feature (lossy)
 *   S22: Remove (hide ...) and (alternate ...) child lists from pins
 *   S23: Downgrade (fill (type color) (color ...)) → (fill (type background))
 */

import {
    findChild,
    findChildren,
    removeChild,
    removeAllChildren,
    setChildValue,
    getChildValue,
} from './sexpr-parser.js';

// --- Version Definitions (Symbol Library specific) ---

export const SYM_VERSIONS = {
    KICAD6: { version: '20211014', generatorVersion: null, label: 'KiCad 6' },
    KICAD7: { version: '20220914', generatorVersion: null, label: 'KiCad 7' },
    KICAD8: { version: '20231120', generatorVersion: '8.0', label: 'KiCad 8' },
    KICAD9: { version: '20241209', generatorVersion: '9.0', label: 'KiCad 9' },
    KICAD10: { version: '20251024', generatorVersion: '10.0', label: 'KiCad 10' },
};

// ============================================================
//  KiCad 10 → KiCad 9 Conversion (Symbol Library, NS-series rules)
// ============================================================

export async function applySymK10toK9(ast, log, warnings) {
    const stats = {
        ns1_header: false,
        ns2_lib_symbol_attrs: 0,
        ns3_property_attrs: 0,
        ns4_hide_moved: 0,
        ns6_power_global: 0,
        ns7_body_styles: 0,
        ns8_pin_name_empty: 0,
    };

    // NS1: Header downgrade
    setChildValue(ast, 'version', SYM_VERSIONS.KICAD9.version);
    setChildValue(ast, 'generator_version', SYM_VERSIONS.KICAD9.generatorVersion);
    stats.ns1_header = true;
    log.push(`NS1: Version → ${SYM_VERSIONS.KICAD9.version}, generator_version → "${SYM_VERSIONS.KICAD9.generatorVersion}"`);

    // NS2-NS8: Recursive transformation
    transformSymK10toK9(ast, stats, log, warnings);

    // Summary
    log.push('--- K10→K9 Symbol Library Summary ---');
    log.push(`NS1 Header downgraded: ${stats.ns1_header ? 'Yes' : 'No'}`);
    log.push(`NS2 lib_symbol attrs removed: ${stats.ns2_lib_symbol_attrs}`);
    log.push(`NS3 property show_name/do_not_autoplace removed: ${stats.ns3_property_attrs}`);
    log.push(`NS4 property-level hide moved into effects: ${stats.ns4_hide_moved}`);
    log.push(`NS6 power global → power: ${stats.ns6_power_global}`);
    log.push(`NS7 body_styles removed: ${stats.ns7_body_styles}`);
    log.push(`NS8 empty pin names → tilde: ${stats.ns8_pin_name_empty}`);
}

function transformSymK10toK9(node, stats, log, warnings) {
    if (!node || node.type !== 'list') return;

    // NS2: Remove K10-only lib_symbol attributes (in_pos_files, duplicate_pin_numbers_are_jumpers)
    if (node.name === 'symbol' && node.children.length > 0) {
        const hasInPosFiles = node.children.some(c => c.type === 'list' && c.name === 'in_pos_files');
        if (hasInPosFiles) {
            const r1 = removeAllChildren(node, 'in_pos_files');
            const r2 = removeAllChildren(node, 'duplicate_pin_numbers_are_jumpers');
            stats.ns2_lib_symbol_attrs += r1 + r2;
        }
    }

    // NS3: Remove show_name and do_not_autoplace from property nodes
    if (node.name === 'property') {
        const r1 = removeAllChildren(node, 'show_name');
        const r2 = removeAllChildren(node, 'do_not_autoplace');
        stats.ns3_property_attrs += r1 + r2;

        // NS4: Move property-level (hide yes) into effects node
        // In K10: (property "X" ... (hide yes) (effects ...))
        // In K9:  (property "X" ... (effects ... (hide yes)))
        const hideIdx = node.children.findIndex(c => c.type === 'list' && c.name === 'hide');
        if (hideIdx >= 0) {
            const hideNode = node.children[hideIdx];
            const hideValue = hideNode.children.length > 0 ? hideNode.children[0].value : 'yes';
            // Remove from property level
            node.children.splice(hideIdx, 1);
            // Add inside effects node
            if (hideValue === 'yes') {
                const effectsNode = findChild(node, 'effects');
                if (effectsNode) {
                    effectsNode.children.push({
                        type: 'list',
                        name: 'hide',
                        children: [{ type: 'atom', value: 'yes' }],
                    });
                    stats.ns4_hide_moved++;
                }
            }
        }
    }

    // NS6: Convert (power global) → (power)
    if (node.name === 'power') {
        const globalIdx = node.children.findIndex(c => c.type === 'atom' && c.value === 'global');
        if (globalIdx >= 0) {
            node.children.splice(globalIdx, 1);
            stats.ns6_power_global++;
        }
    }

    // NS7: Remove body_styles from symbols
    if (node.name === 'symbol') {
        const removed = removeAllChildren(node, 'body_styles');
        if (removed > 0) {
            stats.ns7_body_styles += removed;
        }
    }

    // NS8: Convert empty pin names to tilde
    // K10 uses (name "") for unnamed pins, K9 uses (name "~")
    if (node.name === 'name') {
        if (node.children.length > 0) {
            const nameChild = node.children[0];
            if ((nameChild.type === 'string' || nameChild.type === 'atom') && nameChild.value === '') {
                nameChild.value = '~';
                stats.ns8_pin_name_empty++;
            }
        }
    }

    for (const child of node.children) {
        transformSymK10toK9(child, stats, log, warnings);
    }
}

// ============================================================
//  KiCad 9 → KiCad 8 Conversion (Symbol Library)
// ============================================================

export async function applySymK9toK8(ast, log, warnings) {
    const stats = {
        s1_header: false,
        s2_pin_names_hide: 0,
        s3_pin_hide: 0,
        s4_embedded_fonts: 0,
    };

    // S1: Header downgrade
    setChildValue(ast, 'version', SYM_VERSIONS.KICAD8.version);
    setChildValue(ast, 'generator_version', SYM_VERSIONS.KICAD8.generatorVersion);
    stats.s1_header = true;
    log.push(`S1: Version → ${SYM_VERSIONS.KICAD8.version}, generator_version → "${SYM_VERSIONS.KICAD8.generatorVersion}"`);

    // S2-S4: Recursive transformation
    transformSymK9toK8(ast, stats, log, warnings);

    // Summary
    log.push('--- K9→K8 Symbol Library Summary ---');
    log.push(`S1 Header downgraded: ${stats.s1_header ? 'Yes' : 'No'}`);
    log.push(`S2 pin_names/pin_numbers hide converted: ${stats.s2_pin_names_hide}`);
    log.push(`S3 pin hide converted: ${stats.s3_pin_hide}`);
    log.push(`S4 embedded_fonts removed: ${stats.s4_embedded_fonts}`);
}

function transformSymK9toK8(node, stats, log, warnings) {
    if (!node || node.type !== 'list') return;

    // S2: pin_names/pin_numbers hide syntax: (hide yes) → bare hide
    if (node.name === 'pin_names' || node.name === 'pin_numbers') {
        const hideNode = findChild(node, 'hide');
        if (hideNode) {
            const hideValue = hideNode.children.length > 0 ? hideNode.children[0].value : 'yes';
            removeChild(node, 'hide');
            if (hideValue === 'yes') {
                node.children.push({ type: 'atom', value: 'hide' });
                stats.s2_pin_names_hide++;
            }
        }
    }

    // S3: pin hide syntax: (hide yes) → bare hide (insert at same position)
    if (node.name === 'pin') {
        const hideIdx = node.children.findIndex(c => c.type === 'list' && c.name === 'hide');
        if (hideIdx >= 0) {
            const hideNode = node.children[hideIdx];
            const hideValue = hideNode.children.length > 0 ? hideNode.children[0].value : 'yes';
            node.children.splice(hideIdx, 1);
            if (hideValue === 'yes') {
                node.children.splice(hideIdx, 0, { type: 'atom', value: 'hide' });
                stats.s3_pin_hide++;
            }
        }
    }

    // S4: Remove embedded_fonts from symbol definitions
    if (node.name === 'symbol' && node.children.length > 0) {
        const removedFonts = removeAllChildren(node, 'embedded_fonts');
        if (removedFonts > 0) {
            stats.s4_embedded_fonts += removedFonts;
        }
    }

    for (const child of node.children) {
        transformSymK9toK8(child, stats, log, warnings);
    }
}

// ============================================================
//  KiCad 8 → KiCad 7 Conversion (Symbol Library)
// ============================================================

export async function applySymK8toK7(ast, log, warnings) {
    const stats = {
        s10_header: false,
        s11_exclude_from_sim: 0,
        s12_description: 0,
        s13_hide_syntax: 0,
        s14_pin_names: 0,
    };

    // S10: Header downgrade
    setChildValue(ast, 'version', SYM_VERSIONS.KICAD7.version);
    removeChild(ast, 'generator_version');

    // Unquote generator: change from string to atom
    const generatorNode = findChild(ast, 'generator');
    if (generatorNode && generatorNode.children.length > 0) {
        const genChild = generatorNode.children[0];
        if (genChild.type === 'string') {
            genChild.type = 'atom';
        }
    }
    stats.s10_header = true;
    log.push(`S10: Version → ${SYM_VERSIONS.KICAD7.version}, removed generator_version, unquoted generator`);

    // S11-S14: Recursive transformation
    transformSymK8toK7(ast, stats, log, warnings);

    // Summary
    log.push('--- K8→K7 Symbol Library Summary ---');
    log.push(`S10 Header downgraded: ${stats.s10_header ? 'Yes' : 'No'}`);
    log.push(`S11 exclude_from_sim removed: ${stats.s11_exclude_from_sim}`);
    log.push(`S12 Description→ki_description renamed: ${stats.s12_description}`);
    log.push(`S13 list→atom keywords converted: ${stats.s13_hide_syntax}`);
    log.push(`S14 pin_numbers/pin_names adjusted: ${stats.s14_pin_names}`);
}

function transformSymK8toK7(node, stats, log, warnings) {
    if (!node || node.type !== 'list') return;

    // S11: Remove exclude_from_sim from ALL nodes
    {
        const removed = removeAllChildren(node, 'exclude_from_sim');
        if (removed > 0) {
            stats.s11_exclude_from_sim += removed;
        }
    }

    // S12: Rename (property "Description" ...) → (property "ki_description" ...)
    // In K8/K9, symbols use "Description"; in K7, they use "ki_description"
    if (node.name === 'symbol') {
        const propNodes = findChildren(node, 'property');
        for (const prop of propNodes) {
            if (prop.children.length > 0) {
                const nameChild = prop.children[0];
                if ((nameChild.type === 'string' || nameChild.type === 'atom') && nameChild.value === 'Description') {
                    nameChild.value = 'ki_description';
                    stats.s12_description++;
                }
            }
        }
    }

    // S13: Convert (hide yes), (bold yes), (italic yes) list syntax to bare atoms
    if (node.name === 'effects' || node.name === 'font') {
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
                stats.s13_hide_syntax++;
            }
        }
    }

    // S14: Handle pin_numbers/pin_names for K7
    // K8: (pin_numbers hide) → K7: remove entire pin_numbers node (K7 doesn't use it)
    // K8: (pin_names (offset 0) hide) → K7: (pin_names (offset 0)) (remove hide, keep node)
    if (node.name === 'pin_numbers') {
        // For K7, the pin_numbers node with just 'hide' should be removed entirely
        // Check if it only has a bare 'hide' atom
        const hasOnlyHide = node.children.length === 1 &&
            node.children[0].type === 'atom' && node.children[0].value === 'hide';
        const isEmpty = node.children.length === 0;
        if (hasOnlyHide || isEmpty) {
            // Mark for removal - parent will handle
            node._removeMe = true;
            stats.s14_pin_names++;
        }
    }

    if (node.name === 'pin_names') {
        // K8: (pin_names (offset 0) hide) → K7: (pin_names (offset 0))
        // Remove the bare 'hide' atom
        const hideIdx = node.children.findIndex(c => c.type === 'atom' && c.value === 'hide');
        if (hideIdx >= 0) {
            node.children.splice(hideIdx, 1);
            stats.s14_pin_names++;
        }
    }

    // Remove children marked for removal (pin_numbers with _removeMe)
    if (node.children) {
        const beforeLen = node.children.length;
        node.children = node.children.filter(c => {
            if (c.type === 'list' && c.name === 'pin_numbers' && c._removeMe) {
                return false;
            }
            return true;
        });
        // Clean up any remaining _removeMe flags
    }

    for (const child of node.children) {
        transformSymK8toK7(child, stats, log, warnings);
    }
}

// ============================================================
//  KiCad 7 → KiCad 6 Conversion (Symbol Library, S20-series rules)
// ============================================================
//
// The main .kicad_sym change KiCad 7 introduced over KiCad 6 is symbol text
// boxes. The remaining rules normalize pin/fill syntax defensively.

export async function applySymK7toK6(ast, log, warnings) {
    const stats = {
        s20_header: false,
        s21_text_boxes: 0,
        s22_pin_attrs: 0,
        s23_fill_colors: 0,
    };

    // S20: Header downgrade (K7 symbol libs have no generator_version)
    setChildValue(ast, 'version', SYM_VERSIONS.KICAD6.version);
    removeChild(ast, 'generator_version');
    stats.s20_header = true;
    log.push(`S20: Version → ${SYM_VERSIONS.KICAD6.version}, removed generator_version`);

    transformSymK7toK6(ast, stats, log, warnings);

    if (stats.s21_text_boxes > 0) {
        warnings.push(`Removed ${stats.s21_text_boxes} symbol text box(es) - KiCad 7 feature not available in KiCad 6`);
    }

    // Summary
    log.push('--- K7→K6 Symbol Library Summary ---');
    log.push(`S20 Header downgraded: ${stats.s20_header ? 'Yes' : 'No'}`);
    log.push(`S21 text boxes removed: ${stats.s21_text_boxes}`);
    log.push(`S22 pin hide/alternate removed: ${stats.s22_pin_attrs}`);
    log.push(`S23 fill colors downgraded: ${stats.s23_fill_colors}`);
}

function transformSymK7toK6(node, stats, log, warnings) {
    if (!node || node.type !== 'list') return;

    // S21: Remove symbol text boxes (text_box / textbox)
    for (const name of ['text_box', 'textbox']) {
        const removed = removeAllChildren(node, name);
        if (removed > 0) stats.s21_text_boxes += removed;
    }

    // S22: Remove (hide ...) / (alternate ...) list children from pins
    if (node.name === 'pin') {
        for (const attr of ['hide', 'alternate']) {
            const removed = removeAllChildren(node, attr);
            if (removed > 0) stats.s22_pin_attrs += removed;
        }
    }

    // S23: Downgrade (fill (type color) (color ...)) → (fill (type background))
    if (node.name === 'fill') {
        const typeNode = findChild(node, 'type');
        if (typeNode && typeNode.children.length > 0 &&
            String(typeNode.children[0].value).toLowerCase() === 'color') {
            typeNode.children[0].value = 'background';
            const removed = removeAllChildren(node, 'color');
            stats.s23_fill_colors += 1 + removed;
        }
    }

    // S21b: Remove color child from font nodes (KiCad 6 font does not support color)
    if (node.name === 'font') {
        const removed = removeAllChildren(node, 'color');
        if (removed > 0) {
            stats.s21_text_boxes += removed;
        }
    }

    for (const child of node.children) {
        transformSymK7toK6(child, stats, log, warnings);
    }
}
