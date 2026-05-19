/**
 * KiCad PCB (.kicad_pcb) Version Converter
 * 
 * Supports chain-based downgrade conversions for PCB files:
 *   KiCad 10 → KiCad 9
 *   KiCad 9 → KiCad 8
 *   KiCad 8 → KiCad 7
 *   KiCad 10 → KiCad 7 (chained: 10→9→8→7)
 * 
 * Conversion rules (K10 → K9): NP1-NP10
 *   NP1: Header version/generator downgrade
 *   NP2: tenting nested format → compact format
 *   NP3: Remove setup covering/plugging/capping/filling
 *   NP4: Restore K9 pcbplotparams (hpgl*, plotinvisibletext)
 *   NP5: Collect all net names, assign IDs, insert net declaration block
 *   NP6: Convert net references: name→ID in segment/via/pad/zone
 *   NP7: Remove via capping/covering/plugging/filling
 *   NP8: Zone fill: remove island_removal_mode, remove (island) from filled_polygon, add filled_areas_thickness
 *   NP9: Remove footprint units/duplicate_pad_numbers_are_jumpers
 *   NP10: Restore footprint Datasheet/Description unlocked + font thickness
 *   NP11: Remove (radius ...) from gr_rect/fp_rect (K10 rounded rect, not supported in K9)
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
 *   P21: Remove (arrow_direction) and fix (keep_text_aligned) in dimension style;
 *        convert (suppress_zeroes yes) list to bare atom in dimension format
 *   P22: Remove (placement ...) from zone definitions (multi-channel auto-placement area, K9 only)
 *   P23: Rename (curved_edges ...) → (curve_points ...) in pad teardrops
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
 *   P21: Pad attribute compatibility:
 *        - (remove_unused_layers yes) → bare (remove_unused_layers); remove when "no"
 *        - (keep_end_layers yes) → bare (keep_end_layers); remove when "no"
 *        - Remove (pintype ...) and (pinfunction ...) from pads
 *   P22: (fill no) → (fill none) in graphic shapes (fp_circle, fp_rect, etc.)
 *   P23: Remove (unlocked yes) from fp_text nodes (K7 doesn't support it)
 *   P24: Remove (net ...) from gr_* graphical elements (K7 doesn't support net on graphics)
 *   P25: Remove (locked yes) from gr_* graphical elements (K7 doesn't support locked on graphics)
 *   P26: group nodes: (tstamp ...) → (id ...) and remove (locked yes)
 *   P27: Remove K8-only attr flags (dnp, allow_missing_courtyard) from footprints
 *   P28: Remove top-level (generated ...) elements (tuning patterns etc.) — K7 doesn't support them
 *
 * Additional K9→K8 rules:
 *   P27: Rename (solder_paste_margin_ratio) → (solder_paste_ratio) in footprints/pads
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
    KICAD10: { version: '20260206', generatorVersion: '10.0', label: 'KiCad 10' },
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
//  KiCad 10 → KiCad 9 Conversion (PCB)
// ============================================================

/**
 * Collect all unique net names from the AST by scanning segment, via, pad, and zone nodes.
 * Returns a Map of netName → netId (starting from 0 for empty net, 1 for first real net).
 */
function collectAllNetNames(ast) {
    const netNames = new Set();

    function walk(node) {
        if (!node || node.type !== 'list') return;

        // segment: (net "name")
        // arc: (net "name")  — curved traces
        // via: (net "name")
        // zone: (net "name")
        // gr_rect/gr_arc/gr_line/gr_poly/gr_circle: (net "name") on copper layers
        if (node.name === 'segment' || node.name === 'arc' || node.name === 'via' || node.name === 'zone'
            || node.name === 'gr_rect' || node.name === 'gr_arc' || node.name === 'gr_line'
            || node.name === 'gr_poly' || node.name === 'gr_circle') {
            const netNode = findChild(node, 'net');
            if (netNode && netNode.children.length > 0) {
                const nameChild = netNode.children[0];
                if (nameChild.type === 'string' || nameChild.type === 'atom') {
                    netNames.add(nameChild.value);
                }
            }
        }

        // pad: (net "name") — in K10 the pad has only a net name string
        if (node.name === 'pad') {
            const netNode = findChild(node, 'net');
            if (netNode && netNode.children.length > 0) {
                const nameChild = netNode.children[0];
                if (nameChild.type === 'string' || nameChild.type === 'atom') {
                    netNames.add(nameChild.value);
                }
            }
        }

        for (const child of node.children) {
            walk(child);
        }
    }

    walk(ast);

    // Build a map: empty net → 0, then alphabetically sorted remaining nets → 1, 2, 3, ...
    const netMap = new Map();
    netMap.set('', 0);

    const sortedNames = [...netNames].filter(n => n !== '').sort();
    let nextId = 1;
    for (const name of sortedNames) {
        netMap.set(name, nextId++);
    }

    return netMap;
}

export async function applyPcbK10toK9(ast, log, warnings) {
    const stats = {
        np1_header: false,
        np2_tenting: 0,
        np3_setup_via_attrs: 0,
        np4_plotparams: 0,
        np5_net_declarations: 0,
        np6_net_references: 0,
        np7_via_attrs: 0,
        np8_zone_fill: 0,
        np9_footprint_attrs: 0,
        np10_fp_property: 0,
        np11_rounded_rect: 0,
    };

    // NP1: Header downgrade
    setChildValue(ast, 'version', PCB_VERSIONS.KICAD9.version);
    setChildValue(ast, 'generator_version', PCB_VERSIONS.KICAD9.generatorVersion);
    stats.np1_header = true;
    log.push(`NP1: Version → ${PCB_VERSIONS.KICAD9.version}, generator_version → "${PCB_VERSIONS.KICAD9.generatorVersion}"`);

    // NP2: Convert tenting from nested format to compact format
    // K10: (tenting (front yes) (back yes)) → K9: (tenting front back)
    const setupNode = findChild(ast, 'setup');
    if (setupNode) {
        applyNP2Tenting(setupNode, stats, log);

        // NP3: Remove covering/plugging/capping/filling from setup
        applyNP3RemoveSetupViaAttrs(setupNode, stats, log);

        // NP4: Restore K9 pcbplotparams
        applyNP4RestoreK9PlotParams(setupNode, stats, log);
    }

    // NP5: Collect all net names and insert net declarations
    const netMap = collectAllNetNames(ast);
    if (netMap.size > 0) {
        // Find insertion point: right after setup
        const setupIdx = ast.children.findIndex(c => c.type === 'list' && c.name === 'setup');
        const insertIdx = setupIdx >= 0 ? setupIdx + 1 : ast.children.length;

        // Build net declaration nodes sorted by ID
        const sortedEntries = [...netMap.entries()].sort((a, b) => a[1] - b[1]);
        const netNodes = sortedEntries.map(([name, id]) => ({
            type: 'list',
            name: 'net',
            children: [
                { type: 'atom', value: String(id) },
                { type: 'string', value: name },
            ],
        }));

        // Insert all net declarations
        ast.children.splice(insertIdx, 0, ...netNodes);
        stats.np5_net_declarations = netNodes.length;
        log.push(`NP5: Inserted ${netNodes.length} net declarations after setup`);
    }

    // NP6-NP10: Recursive transformation (uses netMap for NP6)
    transformPcbK10toK9(ast, netMap, stats, log, warnings);

    // Summary
    log.push('--- K10→K9 PCB Summary ---');
    log.push(`NP1 Header downgraded: ${stats.np1_header ? 'Yes' : 'No'}`);
    log.push(`NP2 tenting converted to compact format: ${stats.np2_tenting}`);
    log.push(`NP3 setup via-hole attrs removed: ${stats.np3_setup_via_attrs}`);
    log.push(`NP4 K9 plotparams restored: ${stats.np4_plotparams}`);
    log.push(`NP5 net declarations inserted: ${stats.np5_net_declarations}`);
    log.push(`NP6 net references converted: ${stats.np6_net_references}`);
    log.push(`NP7 via attrs removed: ${stats.np7_via_attrs}`);
    log.push(`NP8 zone fill fixed: ${stats.np8_zone_fill}`);
    log.push(`NP9 footprint attrs removed: ${stats.np9_footprint_attrs}`);
    log.push(`NP10 footprint property restored: ${stats.np10_fp_property}`);
    log.push(`NP11 rounded rect radius removed: ${stats.np11_rounded_rect}`);
}

/**
 * NP2: Convert tenting from nested format to compact format.
 * K10: (tenting (front yes) (back yes)) → K9: (tenting front back)
 */
function applyNP2Tenting(setupNode, stats, log) {
    const tentingNode = findChild(setupNode, 'tenting');
    if (!tentingNode) return;

    // Check if it's in K10 nested format (has (front ...) / (back ...) children)
    const frontNode = findChild(tentingNode, 'front');
    const backNode = findChild(tentingNode, 'back');

    if (frontNode || backNode) {
        // Build compact children list
        const newChildren = [];
        if (frontNode) {
            const val = frontNode.children.length > 0 ? frontNode.children[0].value : 'yes';
            if (val === 'yes') {
                newChildren.push({ type: 'atom', value: 'front' });
            }
        }
        if (backNode) {
            const val = backNode.children.length > 0 ? backNode.children[0].value : 'yes';
            if (val === 'yes') {
                newChildren.push({ type: 'atom', value: 'back' });
            }
        }
        tentingNode.children = newChildren;
        stats.np2_tenting++;
        log.push(`NP2: Converted tenting to compact format`);
    }
}

/**
 * NP3: Remove covering/plugging/capping/filling from setup.
 * These are K10-only via hole processing attributes.
 */
function applyNP3RemoveSetupViaAttrs(setupNode, stats, log) {
    const k10Attrs = ['covering', 'plugging', 'capping', 'filling'];
    for (const attr of k10Attrs) {
        const removed = removeAllChildren(setupNode, attr);
        if (removed > 0) {
            stats.np3_setup_via_attrs += removed;
            log.push(`NP3: Removed (${attr}) from setup`);
        }
    }
}

/**
 * NP4: Restore K9 pcbplotparams that K10 removed.
 * Restores: hpglpennumber, hpglpenspeed, hpglpendiameter, plotinvisibletext
 * Also fix float format: ensure trailing zeros for dashed_line_dash_ratio/gap_ratio
 */
function applyNP4RestoreK9PlotParams(setupNode, stats, log) {
    const pcbplotparams = findChild(setupNode, 'pcbplotparams');
    if (!pcbplotparams) return;

    const k9Params = [
        { name: 'hpglpennumber', value: '1' },
        { name: 'hpglpenspeed', value: '20' },
        { name: 'hpglpendiameter', value: '15.000000' },
        { name: 'plotinvisibletext', value: 'no' },
    ];

    for (const param of k9Params) {
        const existing = findChild(pcbplotparams, param.name);
        if (!existing) {
            pcbplotparams.children.push({
                type: 'list',
                name: param.name,
                children: [{ type: 'atom', value: param.value }],
            });
            stats.np4_plotparams++;
            log.push(`NP4: Added (${param.name} ${param.value}) to pcbplotparams`);
        }
    }

    // Fix float format: K10 uses integer format (12), K9 uses (12.000000)
    const floatParams = ['dashed_line_dash_ratio', 'dashed_line_gap_ratio'];
    for (const paramName of floatParams) {
        const node = findChild(pcbplotparams, paramName);
        if (node && node.children.length > 0) {
            const val = node.children[0].value;
            // If the value is an integer (no decimal point), add .000000
            if (val && !val.includes('.')) {
                node.children[0].value = val + '.000000';
                stats.np4_plotparams++;
            }
        }
    }
}

/**
 * Recursive transformation for K10→K9 PCB.
 * Handles NP6, NP7, NP8, NP9, NP10.
 */
function transformPcbK10toK9(node, netMap, stats, log, warnings) {
    if (!node || node.type !== 'list') return;

    // NP6: Convert net references in segment, arc, via, and graphical elements
    // K10: (net "name") → K9: (net ID)
    if (node.name === 'segment' || node.name === 'arc' || node.name === 'via'
        || node.name === 'gr_rect' || node.name === 'gr_arc' || node.name === 'gr_line'
        || node.name === 'gr_poly' || node.name === 'gr_circle') {
        const netNode = findChild(node, 'net');
        if (netNode && netNode.children.length > 0) {
            const nameChild = netNode.children[0];
            if (nameChild.type === 'string' || (nameChild.type === 'atom' && isNaN(Number(nameChild.value)))) {
                const netName = nameChild.value;
                const netId = netMap.get(netName);
                if (netId !== undefined) {
                    netNode.children = [{ type: 'atom', value: String(netId) }];
                    stats.np6_net_references++;
                }
            }
        }
    }

    // NP6: Convert net references in pad
    // K10: (net "name") → K9: (net ID "name")
    if (node.name === 'pad') {
        const netNode = findChild(node, 'net');
        if (netNode && netNode.children.length > 0) {
            const nameChild = netNode.children[0];
            if (nameChild.type === 'string' || (nameChild.type === 'atom' && isNaN(Number(nameChild.value)))) {
                const netName = nameChild.value;
                const netId = netMap.get(netName);
                if (netId !== undefined) {
                    netNode.children = [
                        { type: 'atom', value: String(netId) },
                        { type: 'string', value: netName },
                    ];
                    stats.np6_net_references++;
                }
            }
        }
    }

    // NP6: Convert net references in zone
    // K10: (net "name") → K9: (net ID) + add (net_name "name")
    if (node.name === 'zone') {
        const netNode = findChild(node, 'net');
        if (netNode && netNode.children.length > 0) {
            const nameChild = netNode.children[0];
            if (nameChild.type === 'string' || (nameChild.type === 'atom' && isNaN(Number(nameChild.value)))) {
                const netName = nameChild.value;
                const netId = netMap.get(netName);
                if (netId !== undefined) {
                    // Replace (net "name") with (net ID)
                    netNode.children = [{ type: 'atom', value: String(netId) }];

                    // Add (net_name "name") right after (net ID) if not already present
                    const existingNetName = findChild(node, 'net_name');
                    if (!existingNetName) {
                        const netIdx = node.children.findIndex(c => c === netNode);
                        const insertIdx = netIdx >= 0 ? netIdx + 1 : 1;
                        node.children.splice(insertIdx, 0, {
                            type: 'list',
                            name: 'net_name',
                            children: [{ type: 'string', value: netName }],
                        });
                    }
                    stats.np6_net_references++;
                }
            }
        }
    }

    // NP7: Remove via capping/covering/plugging/filling
    if (node.name === 'via') {
        const viaAttrs = ['capping', 'covering', 'plugging', 'filling'];
        for (const attr of viaAttrs) {
            const removed = removeAllChildren(node, attr);
            if (removed > 0) {
                stats.np7_via_attrs += removed;
            }
        }
    }

    // NP8: Zone fill changes
    // Remove (island_removal_mode ...) from fill; add (filled_areas_thickness no)
    // Also remove (island ...) from filled_polygon nodes (K10-only marker)
    if (node.name === 'zone') {
        const fillNode = findChild(node, 'fill');
        if (fillNode) {
            const removedIsland = removeAllChildren(fillNode, 'island_removal_mode');
            if (removedIsland > 0) {
                stats.np8_zone_fill += removedIsland;
            }
        }

        // Remove (island ...) from filled_polygon children — K10 marks island polygons
        // with (island yes) inside filled_polygon, which K9 doesn't recognize
        const filledPolygons = findChildren(node, 'filled_polygon');
        for (const fp of filledPolygons) {
            const removedFpIsland = removeAllChildren(fp, 'island');
            if (removedFpIsland > 0) {
                stats.np8_zone_fill += removedFpIsland;
            }
        }

        // Add (filled_areas_thickness no) if not present
        const existingFat = findChild(node, 'filled_areas_thickness');
        if (!existingFat) {
            // Insert after fill node
            const fillIdx = node.children.findIndex(c => c.type === 'list' && c.name === 'fill');
            const insertIdx = fillIdx >= 0 ? fillIdx + 1 : node.children.length;
            node.children.splice(insertIdx, 0, {
                type: 'list',
                name: 'filled_areas_thickness',
                children: [{ type: 'atom', value: 'no' }],
            });
            stats.np8_zone_fill++;
        }
    }

    // NP9: Remove footprint-level K10-only attributes
    if (node.name === 'footprint') {
        const fpAttrs = ['units', 'duplicate_pad_numbers_are_jumpers', 'point', 'component_classes'];
        for (const attr of fpAttrs) {
            const removed = removeAllChildren(node, attr);
            if (removed > 0) {
                stats.np9_footprint_attrs += removed;
            }
        }
    }

    // NP10: Restore Datasheet/Description property unlocked and font thickness in footprints
    // K10 removes (unlocked yes) and (thickness 0.15) that K9 has.
    if (node.name === 'footprint') {
        for (const child of node.children) {
            if (child.type !== 'list' || child.name !== 'property') continue;
            if (child.children.length < 1) continue;

            const propName = child.children[0].value;
            if (propName === 'Datasheet' || propName === 'Description') {
                // Add (unlocked yes) if not present, before (layer ...)
                const hasUnlocked = child.children.some(c => c.type === 'list' && c.name === 'unlocked');
                if (!hasUnlocked) {
                    const layerIdx = child.children.findIndex(c => c.type === 'list' && c.name === 'layer');
                    const insertIdx = layerIdx >= 0 ? layerIdx : child.children.length;
                    child.children.splice(insertIdx, 0, {
                        type: 'list',
                        name: 'unlocked',
                        children: [{ type: 'atom', value: 'yes' }],
                    });
                    stats.np10_fp_property++;
                }

                // Add (thickness 0.15) to font if not present
                const effectsNode = findChild(child, 'effects');
                if (effectsNode) {
                    const fontNode = findChild(effectsNode, 'font');
                    if (fontNode) {
                        const hasThickness = fontNode.children.some(c => c.type === 'list' && c.name === 'thickness');
                        if (!hasThickness) {
                            fontNode.children.push({
                                type: 'list',
                                name: 'thickness',
                                children: [{ type: 'atom', value: '0.15' }],
                            });
                            stats.np10_fp_property++;
                        }
                    }
                }
            }
        }
    }

    // NP11: Remove (radius ...) from gr_rect and fp_rect
    // K10 supports rounded rectangles with (radius N) inside gr_rect/fp_rect;
    // K9 does not recognize this attribute and will error on load.
    if (node.name === 'gr_rect' || node.name === 'fp_rect') {
        const removed = removeAllChildren(node, 'radius');
        if (removed > 0) {
            stats.np11_rounded_rect += removed;
        }
    }

    for (const childNode of node.children) {
        transformPcbK10toK9(childNode, netMap, stats, log, warnings);
    }
}

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
        p22_zone_placement: 0,
        p23_curved_edges: 0,
        p27_solder_paste_ratio: 0,
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
    const k9Elements = ['embedded_files', 'component_class', 'component_classes'];
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
    log.push(`P22 Zone placement removed: ${stats.p22_zone_placement}`);
    log.push(`P23 curved_edges→curve_points renamed: ${stats.p23_curved_edges}`);
    log.push(`P27 solder_paste_margin_ratio→solder_paste_ratio renamed: ${stats.p27_solder_paste_ratio}`);
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

    // P27: Rename (solder_paste_margin_ratio ...) → (solder_paste_ratio ...)
    // K9 renamed solder_paste_ratio to solder_paste_margin_ratio; K8 doesn't recognize it.
    if (node.name === 'solder_paste_margin_ratio') {
        node.name = 'solder_paste_ratio';
        stats.p27_solder_paste_ratio = (stats.p27_solder_paste_ratio || 0) + 1;
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

        // P21 (format): Convert (suppress_zeroes yes) list → bare atom suppress_zeroes
        // K9 uses (suppress_zeroes yes/no) as a list, but K8 expects suppress_zeroes as a bare keyword atom.
        const formatNode = findChild(node, 'format');
        if (formatNode) {
            const szIdx = formatNode.children.findIndex(
                c => c.type === 'list' && c.name === 'suppress_zeroes'
            );
            if (szIdx >= 0) {
                const szNode = formatNode.children[szIdx];
                const val = szNode.children.length > 0 ? szNode.children[0].value : 'yes';
                if (val === 'yes') {
                    // Replace with bare atom
                    formatNode.children[szIdx] = { type: 'atom', value: 'suppress_zeroes' };
                } else {
                    // If 'no', remove entirely (default behavior in K8 is no suppression)
                    formatNode.children.splice(szIdx, 1);
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

    // P22: Remove (placement ...) from zone definitions
    // K9 adds (placement (enabled yes) (sheetname "/CHx/")) for multi-channel auto-placement areas.
    // KiCad 8 does not support this property inside zones.
    if (node.name === 'zone') {
        const removed = removeAllChildren(node, 'placement');
        if (removed > 0) {
            stats.p22_zone_placement = (stats.p22_zone_placement || 0) + removed;
            log.push(`P22: Removed ${removed} (placement) from zone`);
            warnings.push(`Removed (placement) from zone - KiCad 9 multi-channel auto-placement feature`);
        }
    }

    // P23: Convert (curved_edges yes/no) → (curve_points N) in pad teardrops
    // K9 uses boolean (curved_edges yes/no), K8 uses numeric (curve_points N).
    // no → 0, yes → 5 (default curve smoothing point count)
    if (node.name === 'teardrops') {
        // Handle K9's curved_edges → rename to curve_points
        const curvedEdges = findChild(node, 'curved_edges');
        if (curvedEdges) {
            curvedEdges.name = 'curve_points';
        }
        // Convert boolean yes/no to numeric for curve_points
        const curvePoints = findChild(node, 'curve_points');
        if (curvePoints && curvePoints.children.length > 0) {
            const val = curvePoints.children[0].value;
            if (val === 'yes' || val === 'no') {
                curvePoints.children[0].value = (val === 'yes') ? '5' : '0';
                stats.p23_curved_edges = (stats.p23_curved_edges || 0) + 1;
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
        p21_pad_compat: 0,
        p21b_hide_syntax: 0,
        p22_fill_no_to_none: 0,
        p23_unlocked_removed: 0,
        p24_gr_net_removed: 0,
        p25_gr_locked_removed: 0,
        p26_group_fixed: 0,
        p27_attr_k8only: 0,
        p28_generated_removed: 0,
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

    // P28: Remove top-level (generated ...) elements (tuning patterns, etc.)
    // KiCad 8 introduced generated objects; KiCad 7 doesn't support them.
    const removedGenerated = removeAllChildren(ast, 'generated');
    if (removedGenerated > 0) {
        stats.p28_generated_removed += removedGenerated;
        log.push(`P28: Removed ${removedGenerated} top-level (generated) element(s)`);
        warnings.push(`Removed ${removedGenerated} generated element(s) (tuning patterns etc.) - KiCad 8 only feature`);
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
    log.push(`P21 pad attributes fixed: ${stats.p21_pad_compat}`);
    log.push(`P21b hide/bold/italic syntax fixed: ${stats.p21b_hide_syntax}`);
    log.push(`P22 fill no→none converted: ${stats.p22_fill_no_to_none}`);
    log.push(`P23 unlocked removed from fp_text: ${stats.p23_unlocked_removed}`);
    log.push(`P24 net removed from gr_* elements: ${stats.p24_gr_net_removed}`);
    log.push(`P25 locked removed from gr_* elements: ${stats.p25_gr_locked_removed}`);
    log.push(`P26 group nodes fixed: ${stats.p26_group_fixed}`);
    log.push(`P27 K8-only attr flags removed: ${stats.p27_attr_k8only}`);
    log.push(`P28 generated elements removed: ${stats.p28_generated_removed}`);
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

    // P21: Fix pad attributes for K7 compatibility
    if (node.name === 'pad') {
        applyP21PadCompat(node, stats);
    }

    // P21: Also remove teardrops and (free yes) from vias
    // K7 doesn't support teardrops anywhere, and doesn't support (free yes) on vias
    // Also convert (remove_unused_layers yes) → bare (remove_unused_layers),
    // (keep_end_layers yes) → bare (keep_end_layers),
    // and remove (zone_layer_connections ...) — K7 doesn't support these on vias.
    if (node.name === 'via') {
        for (let i = node.children.length - 1; i >= 0; i--) {
            const child = node.children[i];
            if (child.type === 'list' && (child.name === 'teardrops' || child.name === 'free' || child.name === 'zone_layer_connections')) {
                node.children.splice(i, 1);
                stats.p21_pad_compat++;
            }
            // Convert remove_unused_layers / keep_end_layers: list→bare atom or remove
            if (child.type === 'list' && (child.name === 'remove_unused_layers' || child.name === 'keep_end_layers')) {
                const value = child.children.length > 0 ? child.children[0].value : 'yes';
                if (value === 'yes') {
                    child.children = []; // bare flag
                } else {
                    node.children.splice(i, 1); // remove entirely
                }
                stats.p21_pad_compat++;
            }
        }
    }

    // P21b: Convert (hide yes), (bold yes), (italic yes) list syntax to bare atoms
    // KiCad 8 uses list syntax, KiCad 7 uses bare keyword atoms
    // This applies to property nodes (hide), effects nodes, font nodes (bold, italic),
    // and model nodes (hide) for 3D model visibility.
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
                stats.p21b_hide_syntax++;
            }
        }
    }

    // P22: Convert (fill no) → (fill none)
    // KiCad 8 uses "no" for unfilled graphic shapes (fp_circle, fp_rect, etc.)
    // KiCad 7 only accepts "yes", "none", or "solid" as fill values.
    if (node.name === 'fill') {
        for (const child of node.children) {
            if (child.type === 'atom' && child.value === 'no') {
                child.value = 'none';
                stats.p22_fill_no_to_none++;
            }
        }
    }

    // P23: Remove (unlocked yes) from fp_text nodes
    // KiCad 8 supports (unlocked yes) on fp_text (especially fp_text user),
    // but KiCad 7 doesn't recognize this attribute.
    if (node.name === 'fp_text') {
        const unlockedIdx = node.children.findIndex(
            c => c.type === 'list' && c.name === 'unlocked'
        );
        if (unlockedIdx >= 0) {
            node.children.splice(unlockedIdx, 1);
            stats.p23_unlocked_removed++;
        }
    }

    // P24: Remove (net ...) from top-level graphical elements
    // KiCad 8 supports net assignment on gr_line, gr_circle, gr_arc, gr_rect, gr_poly
    // KiCad 7 doesn't recognize (net ...) on these elements.
    if (node.name === 'gr_line' || node.name === 'gr_circle' || node.name === 'gr_arc' || node.name === 'gr_rect' || node.name === 'gr_poly' || node.name === 'gr_text') {
        // P24: Remove (net ...)
        const netIdx = node.children.findIndex(
            c => c.type === 'list' && c.name === 'net'
        );
        if (netIdx >= 0) {
            node.children.splice(netIdx, 1);
            stats.p24_gr_net_removed++;
        }

        // P25: Remove (locked yes)
        const lockedIdx = node.children.findIndex(
            c => c.type === 'list' && c.name === 'locked'
        );
        if (lockedIdx >= 0) {
            node.children.splice(lockedIdx, 1);
            stats.p25_gr_locked_removed++;
        }
    }

    // P26: Fix group nodes for K7 compatibility
    // - (tstamp ...) → (id ...) — P11 converts uuid→tstamp globally, but K7 groups use 'id'
    // - Remove (locked yes) — K7 doesn't support locked on groups
    if (node.name === 'group') {
        // Find the identifier node - could be 'uuid' (not yet converted by P11) or 'tstamp' (already converted)
        const idNode = node.children.find(c => c.type === 'list' && (c.name === 'uuid' || c.name === 'tstamp'));
        if (idNode) {
            idNode.name = 'id';
            // Also ensure value is atom (not string) for K7 compatibility
            for (const child of idNode.children) {
                if (child.type === 'string') child.type = 'atom';
            }
            stats.p26_group_fixed++;
        }
        const lockedIdx = node.children.findIndex(c => c.type === 'list' && c.name === 'locked');
        if (lockedIdx >= 0) {
            node.children.splice(lockedIdx, 1);
            stats.p26_group_fixed++;
        }
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
 * P21: Fix pad attributes for K7 compatibility
 * - (remove_unused_layers yes) → bare (remove_unused_layers); remove when "no"
 * - (keep_end_layers yes) → bare (keep_end_layers); remove when "no"
 * - Remove (pintype ...) and (pinfunction ...) from pads
 */
function applyP21PadCompat(padNode, stats) {
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
                // Convert to bare flag: (remove_unused_layers) without arguments
                attrNode.children = [];
            } else {
                // Value is "no" → remove entirely (default behavior in K7)
                padNode.children.splice(idx, 1);
            }
            stats.p21_pad_compat++;
        }
    }

    // Remove K8-only pad attributes
    const k8OnlyAttrs = ['pintype', 'pinfunction', 'teardrops'];
    for (const attrName of k8OnlyAttrs) {
        for (let i = padNode.children.length - 1; i >= 0; i--) {
            const child = padNode.children[i];
            if (child.type === 'list' && child.name === attrName) {
                padNode.children.splice(i, 1);
                stats.p21_pad_compat++;
            }
        }
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
            // Insert 'locked' as atom right after the footprint name string
            // In K7, locked appears as: (footprint "name" locked (layer ...))
            const nameIdx = fpNode.children.findIndex(c => c.type === 'string');
            const insertIdx = nameIdx >= 0 ? nameIdx + 1 : 0;
            fpNode.children.splice(insertIdx, 0, { type: 'atom', value: 'locked' });
            stats.p16_locked++;
        }
    }

    // P16 (fix): If 'locked' is already a bare atom but appears BEFORE the footprint name string,
    // move it to after the name. This happens when the file already has K7-style bare 'locked'
    // but the parser placed it before the name string in children.
    const bareLockedIdx = fpNode.children.findIndex(
        c => c.type === 'atom' && c.value === 'locked'
    );
    if (bareLockedIdx >= 0) {
        const nameIdx = fpNode.children.findIndex(c => c.type === 'string');
        if (nameIdx >= 0 && bareLockedIdx < nameIdx) {
            // locked is before the name string — move it after
            fpNode.children.splice(bareLockedIdx, 1);
            // nameIdx shifted by -1 after removal
            fpNode.children.splice(nameIdx, 0, { type: 'atom', value: 'locked' });
        }
    }

    // P27: Remove K8-only attr flags (dnp, allow_missing_courtyard) from footprint
    // KiCad 8 introduced these flags; KiCad 7 only supports:
    //   through_hole, smd, virtual, board_only, exclude_from_pos_files,
    //   exclude_from_bom, allow_solder_mask_bridges
    const attrNode = findChild(fpNode, 'attr');
    if (attrNode) {
        const k8OnlyFlags = ['dnp', 'allow_missing_courtyard'];
        for (let i = attrNode.children.length - 1; i >= 0; i--) {
            const child = attrNode.children[i];
            if (child.type === 'atom' && k8OnlyFlags.includes(child.value)) {
                attrNode.children.splice(i, 1);
                stats.p27_attr_k8only = (stats.p27_attr_k8only || 0) + 1;
            }
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
            // P14: Remove these standard K8 properties (K7 doesn't have them in footprints)
            propertiesToRemove.push(i);
            stats.p14_properties_removed++;
        } else if (propName !== 'ki_fp_filters' && propName !== 'Sheetname' && propName !== 'Sheetfile') {
            // P14 (extended): Remove all other custom properties
            // K7 footprints only support: Reference, Value (→fp_text), ki_fp_filters, Sheetname, Sheetfile
            // Custom user properties (e.g. "Champ4") with (at)(layer)(hide)(effects) are not supported
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
