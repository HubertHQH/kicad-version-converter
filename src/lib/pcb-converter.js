/**
 * KiCad PCB (.kicad_pcb) Version Converter
 * 
 * Supports chain-based downgrade conversions for PCB files:
 *   KiCad 9 → KiCad 8
 *   KiCad 8 → KiCad 7
 *   KiCad 9 → KiCad 7 (chained: 9→8→7)
 * 
 * Conversion rules (K9 → K8): P1-P9
 *   P1: Header version/generator downgrade
 *   P2: Layer IDs: K9 new scheme → K8 legacy (0-49)
 *   P3: layerselection bitmask: 128-bit → compact format
 *   P4: Remove (tenting ...), add (viasonmask no) to pcbplotparams
 *   P5: Remove (embedded_fonts ...) from top-level and inside footprints
 *   P6: Remove K9-new pcbplotparams: pdf_metadata, pdf_single_document,
 *       plotpadnumbers, hidednponfab, sketchdnponfab, crossoutdnponfab, plot_black_and_white
 *   P7: Restore K8 pcbplotparams: plotreference yes, plotvalue yes, plotfptext yes
 *   P8: Remove K9-only top-level elements (embedded_files, component_class)
 *   P9: Remove font thickness from Datasheet/Description property fonts
 *   P21: Remove (arrow_direction) and fix (keep_text_aligned) in dimension style
 * 
 * Conversion rules (K8 → K7): P10-P20
 *   P10: Header downgrade (version, remove generator_version, unquote generator)
 *   P11: (uuid "xxx") → (tstamp xxx) everywhere
 *   P12: (property "Reference" ...) → (fp_text reference ...)
 *   P13: (property "Value" ...) → (fp_text value ...)
 *   P14: Remove (property "Footprint"/"Datasheet"/"Description" ...)
 *   P15: (sheetname/sheetfile) → (property "Sheetname"/"Sheetfile" ...)
 *   P16: (locked yes) child → locked atom on footprint line
 *   P17: Remove (legacy_teardrops ...) from general
 *   P18: Remove (allow_soldermask_bridges_in_footprints ...) from setup
 *   P19: pcbplotparams booleans yes/no → true/false
 *   P20: Remove K8-new pcbplotparams: pdf_front/back_fp_property_popups, plotfptext
 */

import {
    findChild,
    findChildren,
    removeChild,
    removeAllChildren,
    removePropertyByName,
    setChildValue,
    getChildValue,
} from './sexpr-parser.js';

// --- Version Definitions (PCB specific) ---

const PCB_VERSIONS = {
    KICAD7: { version: '20221018', generatorVersion: null, label: 'KiCad 7' },
    KICAD8: { version: '20240108', generatorVersion: '8.0', label: 'KiCad 8' },
    KICAD9: { version: '20241229', generatorVersion: '9.0', label: 'KiCad 9' },
};

export { PCB_VERSIONS };

// --- Layer ID Mapping ---
// K9 uses a new compact layer numbering scheme, K8/K7 uses legacy 0-49 IDs.
// We map by layer NAME since that's the most reliable identifier.

const K9_TO_K8_LAYER_ID = {
    // Copper layers
    0: 0,     // F.Cu
    2: 31,    // B.Cu
    4: 1,     // In1.Cu
    6: 2,     // In2.Cu
    8: 3,     // In3.Cu  (if present)
    10: 4,    // In4.Cu  (if present)
    12: 5,    // In5.Cu
    14: 6,    // In6.Cu
    // ... more inner copper layers follow the pattern: K9_id → (K9_id / 2)

    // Non-copper layers
    1: 39,    // F.Mask
    3: 38,    // B.Mask
    5: 37,    // F.SilkS
    7: 36,    // B.SilkS
    9: 33,    // F.Adhes
    11: 32,   // B.Adhes
    13: 35,   // F.Paste
    15: 34,   // B.Paste
    17: 40,   // Dwgs.User
    19: 41,   // Cmts.User
    21: 42,   // Eco1.User
    23: 43,   // Eco2.User
    25: 44,   // Edge.Cuts
    27: 45,   // Margin
    29: 46,   // B.CrtYd
    31: 47,   // F.CrtYd
    33: 48,   // B.Fab
    35: 49,   // F.Fab
};

// Build a name-to-legacy-id map for robust conversion
const LAYER_NAME_TO_LEGACY_ID = {
    'F.Cu': 0,
    'In1.Cu': 1, 'In2.Cu': 2, 'In3.Cu': 3, 'In4.Cu': 4,
    'In5.Cu': 5, 'In6.Cu': 6, 'In7.Cu': 7, 'In8.Cu': 8,
    'In9.Cu': 9, 'In10.Cu': 10, 'In11.Cu': 11, 'In12.Cu': 12,
    'In13.Cu': 13, 'In14.Cu': 14, 'In15.Cu': 15, 'In16.Cu': 16,
    'In17.Cu': 17, 'In18.Cu': 18, 'In19.Cu': 19, 'In20.Cu': 20,
    'In21.Cu': 21, 'In22.Cu': 22, 'In23.Cu': 23, 'In24.Cu': 24,
    'In25.Cu': 25, 'In26.Cu': 26, 'In27.Cu': 27, 'In28.Cu': 28,
    'In29.Cu': 29, 'In30.Cu': 30,
    'B.Cu': 31,
    'B.Adhes': 32, 'F.Adhes': 33,
    'B.Paste': 34, 'F.Paste': 35,
    'B.SilkS': 36, 'F.SilkS': 37,
    'B.Mask': 38, 'F.Mask': 39,
    'Dwgs.User': 40, 'Cmts.User': 41,
    'Eco1.User': 42, 'Eco2.User': 43,
    'Edge.Cuts': 44, 'Margin': 45,
    'B.CrtYd': 46, 'F.CrtYd': 47,
    'B.Fab': 48, 'F.Fab': 49,
    'User.1': 50, 'User.2': 51, 'User.3': 52, 'User.4': 53,
    'User.5': 54, 'User.6': 55, 'User.7': 56, 'User.8': 57,
    'User.9': 58,
};

// ============================================================
//  KiCad 9 → KiCad 8 Conversion (PCB)
// ============================================================

export async function applyPcbK9toK8(ast, log, warnings) {
    const stats = {
        p1_header: false,
        p2_layer_ids: 0,
        p3_layerselection: 0,
        p4_tenting: 0,
        p5_embedded_fonts: 0,
        p6_k9_plotparams: 0,
        p7_restored_plotparams: 0,
        p8_k9_elements: 0,
        p9_font_thickness: 0,
        p21_dimension_style: 0,
    };

    // P1: Header downgrade
    setChildValue(ast, 'version', PCB_VERSIONS.KICAD8.version);
    setChildValue(ast, 'generator_version', PCB_VERSIONS.KICAD8.generatorVersion);
    stats.p1_header = true;
    log.push(`P1: Version → ${PCB_VERSIONS.KICAD8.version}, generator_version → "${PCB_VERSIONS.KICAD8.generatorVersion}"`);

    // P2: Convert layer IDs from K9 to K8 legacy scheme
    applyP2LayerIds(ast, stats, log);

    // P3, P4, P6, P7: Setup/pcbplotparams changes
    const setupNode = findChild(ast, 'setup');
    if (setupNode) {
        applyP3Layerselection(setupNode, stats, log);
        applyP4Tenting(ast, setupNode, stats, log);
        applyP6RemoveK9PlotParams(setupNode, stats, log);
        applyP7RestoreK8PlotParams(setupNode, stats, log);
    }

    // P5: Remove embedded_fonts (top-level; footprint-level handled in recursive transform)
    const removedFonts = removeAllChildren(ast, 'embedded_fonts');
    if (removedFonts > 0) {
        stats.p5_embedded_fonts += removedFonts;
    }

    // P8: Remove K9-only top-level elements
    const k9Elements = ['embedded_files', 'component_class'];
    for (const elemName of k9Elements) {
        const removed = removeAllChildren(ast, elemName);
        if (removed > 0) {
            stats.p8_k9_elements += removed;
            log.push(`P8: Removed ${removed} top-level (${elemName}) element(s)`);
            warnings.push(`Removed ${removed} (${elemName}) element(s) - KiCad 9 only feature`);
        }
    }

    // P9: Recursive transformation for font thickness etc.
    transformPcbK9toK8(ast, stats, log, warnings);

    // Summary
    log.push('--- K9→K8 PCB Summary ---');
    log.push(`P1 Header downgraded: ${stats.p1_header ? 'Yes' : 'No'}`);
    log.push(`P2 Layer IDs remapped: ${stats.p2_layer_ids}`);
    log.push(`P3 layerselection reformatted: ${stats.p3_layerselection}`);
    log.push(`P4 tenting→viasonmask: ${stats.p4_tenting}`);
    log.push(`P5 embedded_fonts removed (top-level + footprints): ${stats.p5_embedded_fonts}`);
    log.push(`P6 K9 plotparams removed: ${stats.p6_k9_plotparams}`);
    log.push(`P7 K8 plotparams restored: ${stats.p7_restored_plotparams}`);
    log.push(`P8 K9-only elements removed: ${stats.p8_k9_elements}`);
    log.push(`P9 Font thickness cleaned: ${stats.p9_font_thickness}`);
    log.push(`P21 Dimension style fixed: ${stats.p21_dimension_style}`);
}

/**
 * P2: Convert layer IDs in the (layers ...) definition
 * K9 uses a new numbering scheme; we convert back to legacy 0-49 IDs.
 * 
 * In the AST, a layer definition like (0 "F.Cu" signal "top_copper") is parsed as:
 *   { type: 'list', name: '0', children: [{value:"F.Cu"}, {value:"signal"}, {value:"top_copper"}] }
 * So the layer ID is in layerDef.name, and the layer name string is in layerDef.children[0].
 */
function applyP2LayerIds(ast, stats, log) {
    const layersNode = findChild(ast, 'layers');
    if (!layersNode) return;

    for (const layerDef of layersNode.children) {
        if (layerDef.type !== 'list' || layerDef.children.length < 1) continue;

        // The parser puts the first token (layer ID number) as the node's name
        // e.g. for (2 "B.Cu" signal), name="2", children[0].value="B.Cu"
        const currentId = layerDef.name;
        const nameChild = layerDef.children[0];
        if (!nameChild) continue;

        const layerName = nameChild.value;
        const legacyId = LAYER_NAME_TO_LEGACY_ID[layerName];

        if (legacyId !== undefined && currentId !== String(legacyId)) {
            layerDef.name = String(legacyId);
            stats.p2_layer_ids++;
        }
    }

    if (stats.p2_layer_ids > 0) {
        log.push(`P2: Remapped ${stats.p2_layer_ids} layer IDs to legacy K8 numbering`);
    }
}

/**
 * P3: Convert layerselection bitmask from 128-bit to compact format
 */
function applyP3Layerselection(setupNode, stats, log) {
    const pcbplotparams = findChild(setupNode, 'pcbplotparams');
    if (!pcbplotparams) return;

    const selectionNames = ['layerselection', 'plot_on_all_layers_selection'];
    for (const name of selectionNames) {
        const node = findChild(pcbplotparams, name);
        if (!node || node.children.length === 0) continue;

        const value = node.children[0].value;
        // K9 uses 128-bit format: 0x00000000_00000000_000010fc_ffffffff
        // K8 uses compact format: 0x00010fc_ffffffff
        // If K9 format (has 4 segments), convert to K8 (2 segments)
        if (value && value.startsWith('0x') && (value.match(/_/g) || []).length === 3) {
            // Remove the first two zero segments
            const parts = value.replace('0x', '').split('_');
            if (parts.length === 4) {
                // Take the last two parts, removing leading zeros
                const high = parts[2].replace(/^0+/, '') || '0';
                const low = parts[3];
                const compact = `0x${high}_${low}`;
                node.children[0].value = compact;
                stats.p3_layerselection++;
            }
        }
    }

    if (stats.p3_layerselection > 0) {
        log.push(`P3: Converted ${stats.p3_layerselection} layerselection bitmask(s) to K8 compact format`);
    }
}

/**
 * P4: Remove (tenting ...) from setup, add (viasonmask no) to pcbplotparams
 */
function applyP4Tenting(ast, setupNode, stats, log) {
    // Remove tenting from setup
    const removedTenting = removeAllChildren(setupNode, 'tenting');
    if (removedTenting > 0) {
        stats.p4_tenting += removedTenting;
        log.push(`P4: Removed ${removedTenting} (tenting) element(s) from setup`);
    }

    // Add (viasonmask no) to pcbplotparams if not already present
    const pcbplotparams = findChild(setupNode, 'pcbplotparams');
    if (pcbplotparams) {
        const existing = findChild(pcbplotparams, 'viasonmask');
        if (!existing) {
            // Insert viasonmask after plotframeref
            const plotframerefIdx = pcbplotparams.children.findIndex(
                c => c.type === 'list' && c.name === 'plotframeref'
            );
            const insertIdx = plotframerefIdx >= 0 ? plotframerefIdx + 1 : pcbplotparams.children.length;
            pcbplotparams.children.splice(insertIdx, 0, {
                type: 'list',
                name: 'viasonmask',
                children: [{ type: 'atom', value: 'no' }],
            });
            stats.p4_tenting++;
            log.push(`P4: Added (viasonmask no) to pcbplotparams`);
        }
    }
}

/**
 * P6: Remove K9-new pcbplotparams parameters
 */
function applyP6RemoveK9PlotParams(setupNode, stats, log) {
    const pcbplotparams = findChild(setupNode, 'pcbplotparams');
    if (!pcbplotparams) return;

    const k9Params = [
        'pdf_metadata', 'pdf_single_document',
        'plotpadnumbers', 'hidednponfab', 'sketchdnponfab',
        'crossoutdnponfab', 'plot_black_and_white',
    ];

    for (const param of k9Params) {
        const removed = removeAllChildren(pcbplotparams, param);
        if (removed > 0) {
            stats.p6_k9_plotparams += removed;
            log.push(`P6: Removed (${param}) from pcbplotparams`);
        }
    }
}

/**
 * P7: Restore K8 pcbplotparams parameters that K9 removed
 */
function applyP7RestoreK8PlotParams(setupNode, stats, log) {
    const pcbplotparams = findChild(setupNode, 'pcbplotparams');
    if (!pcbplotparams) return;

    const k8Params = [
        { name: 'plotreference', value: 'yes' },
        { name: 'plotvalue', value: 'yes' },
        { name: 'plotfptext', value: 'yes' },
    ];

    for (const param of k8Params) {
        const existing = findChild(pcbplotparams, param.name);
        if (!existing) {
            // Insert before plotinvisibletext if possible
            const plotinvisibletextIdx = pcbplotparams.children.findIndex(
                c => c.type === 'list' && c.name === 'plotinvisibletext'
            );
            const insertIdx = plotinvisibletextIdx >= 0 ? plotinvisibletextIdx : pcbplotparams.children.length;
            pcbplotparams.children.splice(insertIdx, 0, {
                type: 'list',
                name: param.name,
                children: [{ type: 'atom', value: param.value }],
            });
            stats.p7_restored_plotparams++;
            log.push(`P7: Added (${param.name} ${param.value}) to pcbplotparams`);
        }
    }
}

/**
 * Recursive transformation for K9→K8 PCB
 */
function transformPcbK9toK8(node, stats, log, warnings) {
    if (!node || node.type !== 'list') return;

    // P5 (extended): Remove embedded_fonts from inside footprints
    // K9 adds (embedded_fonts no) to every footprint; K8 doesn't support it there.
    if (node.name === 'footprint') {
        const removed = removeAllChildren(node, 'embedded_fonts');
        if (removed > 0) {
            stats.p5_embedded_fonts += removed;
        }
    }

    // P21: Fix dimension style nodes for K8 compatibility
    // K9 adds (arrow_direction outward) which K8 doesn't support.
    // K9 uses (keep_text_aligned yes) as a list, but K8 expects a bare atom.
    if (node.name === 'dimension') {
        const styleNode = findChild(node, 'style');
        if (styleNode) {
            const removedArrowDir = removeAllChildren(styleNode, 'arrow_direction');
            if (removedArrowDir > 0) {
                stats.p21_dimension_style = (stats.p21_dimension_style || 0) + removedArrowDir;
            }
            // Convert (keep_text_aligned yes) list → bare atom keep_text_aligned
            const keepAlignedIdx = styleNode.children.findIndex(
                c => c.type === 'list' && c.name === 'keep_text_aligned'
            );
            if (keepAlignedIdx >= 0) {
                const keepAlignedNode = styleNode.children[keepAlignedIdx];
                const val = keepAlignedNode.children.length > 0 ? keepAlignedNode.children[0].value : 'yes';
                if (val === 'yes') {
                    // Replace with bare atom
                    styleNode.children[keepAlignedIdx] = { type: 'atom', value: 'keep_text_aligned' };
                } else {
                    // If not yes, just remove it
                    styleNode.children.splice(keepAlignedIdx, 1);
                }
                stats.p21_dimension_style = (stats.p21_dimension_style || 0) + 1;
            }
        }
    }

    // P9: Remove font thickness from property fonts (K9 adds thickness to Datasheet/Description)
    if (node.name === 'property') {
        const nameChild = node.children[0];
        if (nameChild && (nameChild.value === 'Datasheet' || nameChild.value === 'Description')) {
            const effectsNode = findChild(node, 'effects');
            if (effectsNode) {
                const fontNode = findChild(effectsNode, 'font');
                if (fontNode) {
                    const removed = removeAllChildren(fontNode, 'thickness');
                    if (removed > 0) {
                        stats.p9_font_thickness += removed;
                    }
                }
            }
        }
    }

    for (const child of node.children) {
        transformPcbK9toK8(child, stats, log, warnings);
    }
}

// ============================================================
//  KiCad 8 → KiCad 7 Conversion (PCB)
// ============================================================

export async function applyPcbK8toK7(ast, log, warnings) {
    const stats = {
        p10_header: false,
        p11_uuid_to_tstamp: 0,
        p12_property_to_fptext: 0,
        p14_properties_removed: 0,
        p15_sheetname_sheetfile: 0,
        p16_locked: 0,
        p17_legacy_teardrops: 0,
        p18_soldermask_bridges: 0,
        p19_bool_conversion: 0,
        p20_k8_plotparams: 0,
    };

    // P10: Header downgrade
    setChildValue(ast, 'version', PCB_VERSIONS.KICAD7.version);
    removeChild(ast, 'generator_version');

    // Unquote generator: change from string to atom
    const generatorNode = findChild(ast, 'generator');
    if (generatorNode && generatorNode.children.length > 0) {
        const genChild = generatorNode.children[0];
        if (genChild.type === 'string') {
            genChild.type = 'atom';
        }
    }
    stats.p10_header = true;
    log.push(`P10: Version → ${PCB_VERSIONS.KICAD7.version}, removed generator_version, unquoted generator`);

    // P17: Remove (legacy_teardrops) from general
    const generalNode = findChild(ast, 'general');
    if (generalNode) {
        const removed = removeAllChildren(generalNode, 'legacy_teardrops');
        if (removed > 0) {
            stats.p17_legacy_teardrops += removed;
            log.push(`P17: Removed (legacy_teardrops) from general`);
        }
    }

    // P18: Remove (allow_soldermask_bridges_in_footprints) from setup
    const setupNode = findChild(ast, 'setup');
    if (setupNode) {
        const removed = removeAllChildren(setupNode, 'allow_soldermask_bridges_in_footprints');
        if (removed > 0) {
            stats.p18_soldermask_bridges += removed;
            log.push(`P18: Removed (allow_soldermask_bridges_in_footprints) from setup`);
        }

        // P19: Convert booleans in pcbplotparams
        applyP19BoolConversion(setupNode, stats, log);

        // P20: Remove K8-new pcbplotparams
        applyP20RemoveK8PlotParams(setupNode, stats, log);
    }

    // P11-P16: Recursive transformation
    transformPcbK8toK7(ast, stats, log, warnings);

    // Summary
    log.push('--- K8→K7 PCB Summary ---');
    log.push(`P10 Header downgraded: ${stats.p10_header ? 'Yes' : 'No'}`);
    log.push(`P11 uuid→tstamp converted: ${stats.p11_uuid_to_tstamp}`);
    log.push(`P12 property→fp_text converted: ${stats.p12_property_to_fptext}`);
    log.push(`P14 properties removed: ${stats.p14_properties_removed}`);
    log.push(`P15 sheetname/sheetfile converted: ${stats.p15_sheetname_sheetfile}`);
    log.push(`P16 locked syntax converted: ${stats.p16_locked}`);
    log.push(`P17 legacy_teardrops removed: ${stats.p17_legacy_teardrops}`);
    log.push(`P18 soldermask_bridges removed: ${stats.p18_soldermask_bridges}`);
    log.push(`P19 booleans yes/no→true/false: ${stats.p19_bool_conversion}`);
    log.push(`P20 K8 plotparams removed: ${stats.p20_k8_plotparams}`);
}

/**
 * P19: Convert yes/no → true/false in pcbplotparams
 */
function applyP19BoolConversion(setupNode, stats, log) {
    const pcbplotparams = findChild(setupNode, 'pcbplotparams');
    if (!pcbplotparams) return;

    for (const child of pcbplotparams.children) {
        if (child.type !== 'list' || child.children.length === 0) continue;
        const valChild = child.children[child.children.length - 1];
        if (valChild.type === 'atom') {
            if (valChild.value === 'yes') {
                valChild.value = 'true';
                stats.p19_bool_conversion++;
            } else if (valChild.value === 'no') {
                valChild.value = 'false';
                stats.p19_bool_conversion++;
            }
        }
    }

    if (stats.p19_bool_conversion > 0) {
        log.push(`P19: Converted ${stats.p19_bool_conversion} boolean values yes/no → true/false in pcbplotparams`);
    }
}

/**
 * P20: Remove K8-new pcbplotparams parameters
 */
function applyP20RemoveK8PlotParams(setupNode, stats, log) {
    const pcbplotparams = findChild(setupNode, 'pcbplotparams');
    if (!pcbplotparams) return;

    const k8Params = [
        'pdf_front_fp_property_popups',
        'pdf_back_fp_property_popups',
        'plotfptext',
    ];

    for (const param of k8Params) {
        const removed = removeAllChildren(pcbplotparams, param);
        if (removed > 0) {
            stats.p20_k8_plotparams += removed;
            log.push(`P20: Removed (${param}) from pcbplotparams`);
        }
    }
}

/**
 * Recursive transformation for K8→K7 PCB
 */
function transformPcbK8toK7(node, stats, log, warnings) {
    if (!node || node.type !== 'list') return;

    // P11: Convert (uuid "xxx") → (tstamp xxx)
    if (node.name === 'uuid') {
        node.name = 'tstamp';
        // Change the value child from string to atom (remove quotes)
        for (const child of node.children) {
            if (child.type === 'string') {
                child.type = 'atom';
            }
        }
        stats.p11_uuid_to_tstamp++;
    }

    // Process footprint-level transformations
    if (node.name === 'footprint') {
        transformFootprintK8toK7(node, stats, log, warnings);
    }

    for (const child of node.children) {
        transformPcbK8toK7(child, stats, log, warnings);
    }
}

/**
 * Transform a footprint node from K8 to K7 format
 */
function transformFootprintK8toK7(fpNode, stats, log, warnings) {
    // P16: Convert (locked yes) child → locked atom on footprint line
    const lockedIdx = fpNode.children.findIndex(
        c => c.type === 'list' && c.name === 'locked'
    );
    if (lockedIdx >= 0) {
        const lockedNode = fpNode.children[lockedIdx];
        const lockedValue = lockedNode.children.length > 0 ? lockedNode.children[0].value : 'yes';
        fpNode.children.splice(lockedIdx, 1);
        if (lockedValue === 'yes') {
            // Insert 'locked' as atom right after the footprint name (position 0)
            // In K7, locked appears as: (footprint "name" locked (layer ...))
            fpNode.children.splice(0, 0, { type: 'atom', value: 'locked' });
            stats.p16_locked++;
        }
    }

    // P12/P13: Convert property "Reference"/"Value" → fp_text reference/value
    const propertiesToConvert = [];
    const propertiesToRemove = [];

    for (let i = fpNode.children.length - 1; i >= 0; i--) {
        const child = fpNode.children[i];
        if (child.type !== 'list' || child.name !== 'property') continue;
        if (child.children.length < 2) continue;

        const propName = child.children[0].value;

        if (propName === 'Reference' || propName === 'Value') {
            // P12/P13: Convert to fp_text
            const propValue = child.children[1]?.value || '';
            const fpTextType = propName === 'Reference' ? 'reference' : 'value';

            // Build new fp_text node
            const newNode = {
                type: 'list',
                name: 'fp_text',
                children: [
                    { type: 'atom', value: fpTextType },
                    { type: 'string', value: propValue },
                ],
            };

            // Copy remaining children (at, layer, effects, etc.) but skip uuid → tstamp handled elsewhere
            for (let j = 2; j < child.children.length; j++) {
                const sub = child.children[j];
                // Skip unlocked property (K7 doesn't have it)
                if (sub.type === 'list' && sub.name === 'unlocked') continue;
                // Skip hide property (K7 doesn't have it on fp_text ref/value normally)
                if (sub.type === 'list' && sub.name === 'hide') continue;
                newNode.children.push(sub);
            }

            fpNode.children[i] = newNode;
            stats.p12_property_to_fptext++;
        } else if (propName === 'Footprint' || propName === 'Datasheet' || propName === 'Description') {
            // P14: Remove these properties (K7 doesn't have them in footprints)
            propertiesToRemove.push(i);
            stats.p14_properties_removed++;
        }
    }

    // Remove marked properties (in reverse order to preserve indices)
    for (const idx of propertiesToRemove) {
        fpNode.children.splice(idx, 1);
    }

    // P15: Convert (sheetname ...) and (sheetfile ...) → (property "Sheetname"/"Sheetfile" ...)
    const sheetNameNode = findChild(fpNode, 'sheetname');
    const sheetFileNode = findChild(fpNode, 'sheetfile');

    if (sheetNameNode) {
        const value = sheetNameNode.children.length > 0 ? sheetNameNode.children[0].value : '';
        removeChild(fpNode, 'sheetname');
        // In K7, these are stored as: (property "Sheetname" "value")
        // Insert before path node
        const pathIdx = fpNode.children.findIndex(c => c.type === 'list' && c.name === 'path');
        const insertIdx = pathIdx >= 0 ? pathIdx : fpNode.children.length;
        fpNode.children.splice(insertIdx, 0, {
            type: 'list',
            name: 'property',
            children: [
                { type: 'string', value: 'Sheetname' },
                { type: 'string', value: value },
            ],
        });
        stats.p15_sheetname_sheetfile++;
    }

    if (sheetFileNode) {
        const value = sheetFileNode.children.length > 0 ? sheetFileNode.children[0].value : '';
        removeChild(fpNode, 'sheetfile');
        const pathIdx = fpNode.children.findIndex(c => c.type === 'list' && c.name === 'path');
        const insertIdx = pathIdx >= 0 ? pathIdx : fpNode.children.length;
        fpNode.children.splice(insertIdx, 0, {
            type: 'list',
            name: 'property',
            children: [
                { type: 'string', value: 'Sheetfile' },
                { type: 'string', value: value },
            ],
        });
        stats.p15_sheetname_sheetfile++;
    }
}
