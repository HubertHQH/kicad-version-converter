/**
 * KiCad Multi-Version Converter
 * 
 * Supports chain-based downgrade conversions for all file types:
 *   .kicad_sch (Schematic), .kicad_sym (Symbol Library), .kicad_pcb (PCB), .kicad_mod (Footprint)
 * 
 * Conversion paths:
 *   KiCad 10 → KiCad 9
 *   KiCad 9 → KiCad 8
 *   KiCad 8 → KiCad 7
 *   KiCad 7 → KiCad 6
 *   Chained downgrades, e.g. KiCad 10 → KiCad 6 (10→9→8→7→6)
 * 
 * Schematic conversion rules (K10 → K9): N1-N10
 * Schematic conversion rules (K9 → K8): R1-R8
 * Schematic conversion rules (K8 → K7): R10-R15
 * Schematic conversion rules (K7 → K6): R20-R30
 * Symbol library conversion rules (K10 → K9): NS1-NS8
 * Symbol library conversion rules (K9 → K8): S1-S4
 * Symbol library conversion rules (K8 → K7): S10-S14
 * Symbol library conversion rules (K7 → K6): S20-S23
 * PCB conversion rules (K10 → K9): NP1-NP11
 * PCB conversion rules (K9 → K8): P1-P9, P21-P23, P27
 * PCB conversion rules (K8 → K7): P10-P28
 * PCB conversion rules (K7 → K6): P40-P49
 * Footprint conversion rules (K10 → K9): NF1-NF3
 * Footprint conversion rules (K9 → K8): F1-F4
 * Footprint conversion rules (K8 → K7): F10-F18
 * Footprint conversion rules (K7 → K6): F20-F26
 */

import {
    parseSExpr,
    serializeSExpr,
    findChild,
    findChildren,
    removeChild,
    removeAllChildren,
    removePropertyByName,
    setChildValue,
    getChildValue,
} from './sexpr-parser.js';

import {
    applySymK10toK9,
    applySymK9toK8,
    applySymK8toK7,
    applySymK7toK6,
    SYM_VERSIONS,
} from './sym-converter.js';

import {
    applyPcbK10toK9,
    applyPcbK9toK8,
    applyPcbK8toK7,
    applyPcbK7toK6,
    PCB_VERSIONS,
} from './pcb-converter.js';

import {
    applyFpK10toK9,
    applyFpK9toK8,
    applyFpK8toK7,
    applyFpK7toK6,
    FP_VERSIONS,
} from './fp-converter.js';

// --- Version Definitions ---

// Schematic (.kicad_sch) versions
const VERSIONS = {
    KICAD6: { version: '20211123', generatorVersion: null, label: 'KiCad 6' },
    KICAD7: { version: '20230121', generatorVersion: null, label: 'KiCad 7' },
    KICAD8: { version: '20231120', generatorVersion: '8.0', label: 'KiCad 8' },
    KICAD9: { version: '20250114', generatorVersion: '9.0', label: 'KiCad 9' },
    KICAD10: { version: '20260101', generatorVersion: '10.0', label: 'KiCad 10' },
};

// SYM_VERSIONS imported from sym-converter.js

// File types
const FILE_TYPES = {
    SCHEMATIC: 'kicad_sch',
    SYMBOL_LIB: 'kicad_symbol_lib',
    PCB: 'kicad_pcb',
    FOOTPRINT: 'footprint',
};

/**
 * Detect the KiCad version of input text.
 * @param {string} input 
 * @returns {{ version: string, generatorVersion: string, detectedVersion: object, label: string, isKicad9: boolean }}
 */
export function detectVersion(input) {
    const versionMatch = input.match(/\(version\s+(\d+)\)/);
    const generatorMatch = input.match(/\(generator_version\s+"([^"]+)"\)/);

    const version = versionMatch ? versionMatch[1] : 'unknown';
    const generatorVersion = generatorMatch ? generatorMatch[1] : 'unknown';

    // Detect file type to use correct version table
    let versionTable = VERSIONS; // default: schematic
    if (input.match(/^\s*\(kicad_pcb\b/)) {
        versionTable = PCB_VERSIONS;
    } else if (input.match(/^\s*\(kicad_symbol_lib\b/)) {
        versionTable = SYM_VERSIONS;
    } else if (input.match(/^\s*\(footprint\b/)) {
        versionTable = FP_VERSIONS;
    }

    // Determine which major version this corresponds to.
    // Each major version is identified by being strictly greater than the
    // stamp of the version below it (numbers are date stamps).
    const versionNum = parseInt(version);
    let detectedVersion = null;
    let label = 'Unknown';
    let detectedKey = null;

    const k9VersionNum = parseInt(versionTable.KICAD9.version);
    const k8VersionNum = parseInt(versionTable.KICAD8.version);
    const k7VersionNum = parseInt(versionTable.KICAD7.version);
    const k6VersionNum = versionTable.KICAD6 ? parseInt(versionTable.KICAD6.version) : -1;

    if (versionNum > k9VersionNum) {
        detectedVersion = versionTable.KICAD10;
        label = 'KiCad 10';
        detectedKey = 'KICAD10';
    } else if (versionNum > k8VersionNum) {
        detectedVersion = versionTable.KICAD9;
        label = 'KiCad 9';
        detectedKey = 'KICAD9';
    } else if (versionNum > k7VersionNum) {
        detectedVersion = versionTable.KICAD8;
        label = 'KiCad 8';
        detectedKey = 'KICAD8';
    } else if (versionNum > k6VersionNum) {
        detectedVersion = versionTable.KICAD7;
        label = 'KiCad 7';
        detectedKey = 'KICAD7';
    } else if (versionNum >= 20200310) {
        // S-expression format starts from KiCad 6
        detectedVersion = versionTable.KICAD6 || versionTable.KICAD7;
        label = 'KiCad 6';
        detectedKey = 'KICAD6';
    } else {
        label = `v${version}`;
    }

    const isKicad10 = versionNum > k9VersionNum;
    const isKicad9 = versionNum > k8VersionNum;
    const isKicad8 = versionNum > k7VersionNum;
    const isKicad7 = versionNum > k6VersionNum;

    return { version, generatorVersion, detectedVersion, label, detectedKey, isKicad7, isKicad8, isKicad9, isKicad10 };
}

/**
 * Main unified conversion function.
 * Supports both .kicad_sch (Schematic) and .kicad_sym (Symbol Library) files.
 * @param {string} input - KiCad file content
 * @param {string} targetVersionKey - 'KICAD8' or 'KICAD7'
 * @returns {Promise<{ output: string, log: string[], warnings: string[], fileType: string }>}
 */
export async function convertKicad(input, targetVersionKey) {
    const log = [];
    const warnings = [];

    // Parse
    log.push('Parsing S-expression...');
    const ast = parseSExpr(input);

    // Detect file type
    const fileType = ast?.name;
    const isSymbolLib = fileType === FILE_TYPES.SYMBOL_LIB;
    const isSchematic = fileType === FILE_TYPES.SCHEMATIC;
    const isPcb = fileType === FILE_TYPES.PCB;
    const isFootprint = fileType === FILE_TYPES.FOOTPRINT;

    if (!isSymbolLib && !isSchematic && !isPcb && !isFootprint) {
        throw new Error(`Unsupported file type: root element "${fileType}" is not kicad_sch, kicad_symbol_lib, kicad_pcb, or footprint`);
    }

    const fileTypeLabel = isFootprint ? 'Footprint' : (isPcb ? 'PCB' : (isSymbolLib ? 'Symbol Library' : 'Schematic'));
    log.push(`File type: ${fileTypeLabel}`);

    // Use appropriate version table
    const versionTable = isFootprint ? FP_VERSIONS : (isPcb ? PCB_VERSIONS : (isSymbolLib ? SYM_VERSIONS : VERSIONS));
    const targetVersion = versionTable[targetVersionKey];
    if (!targetVersion) {
        throw new Error(`Unknown target version: ${targetVersionKey}`);
    }

    const inputVersion = getChildValue(ast, 'version');
    const inputGenerator = getChildValue(ast, 'generator_version');
    log.push(`Input version: ${inputVersion}, generator: ${inputGenerator}`);

    // Determine input major version
    const inputVersionNum = parseInt(inputVersion);
    const targetVersionNum = parseInt(targetVersion.version);
    const k9VersionNum = parseInt(versionTable.KICAD9.version);
    const k8VersionNum = parseInt(versionTable.KICAD8.version);
    const k7VersionNum = parseInt(versionTable.KICAD7.version);
    const k6VersionNum = versionTable.KICAD6 ? parseInt(versionTable.KICAD6.version) : -1;

    if (inputVersionNum <= targetVersionNum) {
        warnings.push(`File version ${inputVersion} is already ${targetVersion.label} or earlier. No conversion needed.`);
    }

    // Build conversion chain based on file type
    const steps = [];

    // K10 → K9 step
    if (inputVersionNum > k9VersionNum && targetVersionNum <= k9VersionNum) {
        if (isSchematic) {
            steps.push({ from: versionTable.KICAD10, to: versionTable.KICAD9, fn: applyK10toK9 });
        } else if (isSymbolLib) {
            steps.push({ from: versionTable.KICAD10, to: versionTable.KICAD9, fn: applySymK10toK9 });
        } else if (isPcb) {
            steps.push({ from: versionTable.KICAD10, to: versionTable.KICAD9, fn: applyPcbK10toK9 });
        } else if (isFootprint) {
            steps.push({ from: versionTable.KICAD10, to: versionTable.KICAD9, fn: applyFpK10toK9 });
        }
    }

    // K9 → K8 step
    if (inputVersionNum > k8VersionNum && targetVersionNum <= k8VersionNum) {
        if (isFootprint) {
            steps.push({ from: versionTable.KICAD9, to: versionTable.KICAD8, fn: applyFpK9toK8 });
        } else if (isPcb) {
            steps.push({ from: versionTable.KICAD9, to: versionTable.KICAD8, fn: applyPcbK9toK8 });
        } else if (isSymbolLib) {
            steps.push({ from: versionTable.KICAD9, to: versionTable.KICAD8, fn: applySymK9toK8 });
        } else {
            steps.push({ from: versionTable.KICAD9, to: versionTable.KICAD8, fn: applyK9toK8 });
        }
    }

    // K8 → K7 step
    if (inputVersionNum > k7VersionNum && targetVersionNum <= k7VersionNum) {
        if (isFootprint) {
            steps.push({ from: versionTable.KICAD8, to: versionTable.KICAD7, fn: applyFpK8toK7 });
        } else if (isPcb) {
            steps.push({ from: versionTable.KICAD8, to: versionTable.KICAD7, fn: applyPcbK8toK7 });
        } else if (isSymbolLib) {
            steps.push({ from: versionTable.KICAD8, to: versionTable.KICAD7, fn: applySymK8toK7 });
        } else {
            steps.push({ from: versionTable.KICAD8, to: versionTable.KICAD7, fn: applyK8toK7 });
        }
    }

    // K7 → K6 step
    if (inputVersionNum > k6VersionNum && targetVersionNum <= k6VersionNum) {
        if (isFootprint) {
            steps.push({ from: versionTable.KICAD7, to: versionTable.KICAD6, fn: applyFpK7toK6 });
        } else if (isPcb) {
            steps.push({ from: versionTable.KICAD7, to: versionTable.KICAD6, fn: applyPcbK7toK6 });
        } else if (isSymbolLib) {
            steps.push({ from: versionTable.KICAD7, to: versionTable.KICAD6, fn: applySymK7toK6 });
        } else {
            steps.push({ from: versionTable.KICAD7, to: versionTable.KICAD6, fn: applyK7toK6 });
        }
    }

    if (steps.length === 0 && inputVersionNum > targetVersionNum) {
        // Direct header downgrade as fallback
        setChildValue(ast, 'version', targetVersion.version);
        if (targetVersion.generatorVersion) {
            setChildValue(ast, 'generator_version', targetVersion.generatorVersion);
        }
        log.push(`Header downgraded to ${targetVersion.label}`);
    }

    // Execute conversion chain
    for (const step of steps) {
        log.push(`\n─── ${step.from.label} → ${step.to.label} (${fileTypeLabel}) ───`);
        await step.fn(ast, log, warnings);
    }

    // Serialize
    log.push('\nSerializing output...');
    const output = serializeSExpr(ast) + '\n';

    // Detect hierarchical sub-sheets and warn about them
    if (isSchematic && steps.length > 0) {
        const subSheets = [];
        collectSubSheetFiles(ast, subSheets);
        if (subSheets.length > 0) {
            warnings.push(`This schematic references ${subSheets.length} sub-sheet(s) that also need conversion: ${subSheets.join(', ')}`);
            log.push(`\n⚠ Hierarchical schematic detected — ${subSheets.length} sub-sheet(s) must also be converted:`);
            subSheets.forEach(s => log.push(`   • ${s}`));
        }
    }

    return { output, log, warnings, fileType: fileTypeLabel };
}

/**
 * Legacy function for backward compatibility.
 */
export async function convertKicad9to8(input) {
    return convertKicad(input, 'KICAD8');
}

// ============================================================
//  Hierarchical Sheet Detection
// ============================================================

/**
 * Collect sub-sheet filenames from (sheet (property "Sheetfile" "xxx.kicad_sch")) nodes.
 */
function collectSubSheetFiles(node, result) {
    if (!node || node.type !== 'list') return;
    if (node.name === 'sheet') {
        for (const child of node.children) {
            if (child.type === 'list' && child.name === 'property' &&
                child.children.length >= 2 &&
                (child.children[0].value === 'Sheetfile' || child.children[0].value === 'Sheet file')) {
                const filename = child.children[1].value;
                if (filename && !result.includes(filename)) {
                    result.push(filename);
                }
            }
        }
        return;
    }
    for (const child of node.children) {
        collectSubSheetFiles(child, result);
    }
}

// ============================================================
//  KiCad 10 → KiCad 9 Conversion (N-series rules)
// ============================================================

async function applyK10toK9(ast, log, warnings) {
    const stats = {
        n1_header: false,
        n2_lib_symbol_attrs: 0,
        n3_property_attrs: 0,
        n4_hide_moved: 0,
        n5_body_style: 0,
        n6_power_global: 0,
        n7_body_styles: 0,
        n8_pin_name_empty: 0,
        n9_variant: 0,
        n10_group: 0,
    };

    // N1: Header downgrade
    setChildValue(ast, 'version', VERSIONS.KICAD9.version);
    setChildValue(ast, 'generator_version', VERSIONS.KICAD9.generatorVersion);
    stats.n1_header = true;
    log.push(`N1: Version → ${VERSIONS.KICAD9.version}, generator_version → "${VERSIONS.KICAD9.generatorVersion}"`);

    // N2-N8: Recursive transformation
    transformK10toK9(ast, stats, log, warnings, false);

    // N10: Remove top-level (group ...) nodes
    // K10 adds group support to schematics (e.g. variant groups); K9 doesn't recognize (group) in schematics
    const removedGroups = removeAllChildren(ast, 'group');
    if (removedGroups > 0) {
        stats.n10_group += removedGroups;
        log.push(`N10: Removed ${removedGroups} (group) element(s)`);
        warnings.push(`Removed ${removedGroups} (group) element(s) - KiCad 10 schematic groups not supported in KiCad 9`);
    }

    // Summary
    log.push('--- K10→K9 Summary ---');
    log.push(`N1 Header downgraded: ${stats.n1_header ? 'Yes' : 'No'}`);
    log.push(`N2 lib_symbol attrs removed: ${stats.n2_lib_symbol_attrs}`);
    log.push(`N3 property show_name/do_not_autoplace removed: ${stats.n3_property_attrs}`);
    log.push(`N4 property-level hide moved into effects: ${stats.n4_hide_moved}`);
    log.push(`N5 body_style removed from instances: ${stats.n5_body_style}`);
    log.push(`N6 power global → power: ${stats.n6_power_global}`);
    log.push(`N7 body_styles removed from lib_symbols: ${stats.n7_body_styles}`);
    log.push(`N8 empty pin names → tilde: ${stats.n8_pin_name_empty}`);
    log.push(`N9 variant removed from path: ${stats.n9_variant}`);
    log.push(`N10 group elements removed: ${stats.n10_group}`);
}

/**
 * Recursively transform K10 AST nodes to K9.
 * @param {boolean} insideLibSymbol - true when traversing nodes under lib_symbols
 */
function transformK10toK9(node, stats, log, warnings, insideLibSymbol) {
    if (!node || node.type !== 'list') return;

    // Track if we're inside a lib_symbol definition (top-level symbol inside lib_symbols)
    const isLibSymbolsContainer = node.name === 'lib_symbols';
    const isTopLibSymbol = insideLibSymbol || isLibSymbolsContainer;

    // N2: Remove K10-only lib_symbol attributes (in_pos_files, duplicate_pin_numbers_are_jumpers)
    // These appear on top-level symbol definitions inside lib_symbols  
    if (node.name === 'symbol' && node.children.length > 0) {
        // Check if this is a lib_symbol definition (direct child of lib_symbols or has sub-symbols)
        const hasInPosFiles = node.children.some(c => c.type === 'list' && c.name === 'in_pos_files');
        if (hasInPosFiles) {
            const r1 = removeAllChildren(node, 'in_pos_files');
            const r2 = removeAllChildren(node, 'duplicate_pin_numbers_are_jumpers');
            stats.n2_lib_symbol_attrs += r1 + r2;
        }
    }

    // N3: Remove show_name and do_not_autoplace from property nodes
    if (node.name === 'property') {
        const r1 = removeAllChildren(node, 'show_name');
        const r2 = removeAllChildren(node, 'do_not_autoplace');
        stats.n3_property_attrs += r1 + r2;

        // N4: Move property-level (hide yes) into effects node
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
                    stats.n4_hide_moved++;
                }
            }
        }
    }

    // N5: Remove body_style from symbol instances (not lib_symbol definitions)
    // body_style appears on placed symbol instances, not on sub-symbol defs
    if (node.name === 'symbol' && !isLibSymbolsContainer) {
        // Check if this is a symbol instance (has lib_id child) vs lib_symbol definition
        const hasLibId = node.children.some(c => c.type === 'list' && c.name === 'lib_id');
        if (hasLibId) {
            const removed = removeAllChildren(node, 'body_style');
            if (removed > 0) {
                stats.n5_body_style += removed;
            }
        }
    }

    // N6: Convert (power global) → (power)
    // K10 uses (power global), K9 uses bare (power) 
    if (node.name === 'power') {
        // Remove the 'global' atom child
        const globalIdx = node.children.findIndex(c => c.type === 'atom' && c.value === 'global');
        if (globalIdx >= 0) {
            node.children.splice(globalIdx, 1);
            stats.n6_power_global++;
        }
    }

    // N7: Remove body_styles from lib_symbol definitions
    if (node.name === 'symbol') {
        const removed = removeAllChildren(node, 'body_styles');
        if (removed > 0) {
            stats.n7_body_styles += removed;
        }
    }

    // N8: Convert empty pin names to tilde in lib_symbol definitions
    // K10 uses (name "") for unnamed pins, K9 uses (name "~")
    if (node.name === 'name' && insideLibSymbol) {
        if (node.children.length > 0) {
            const nameChild = node.children[0];
            if ((nameChild.type === 'string' || nameChild.type === 'atom') && nameChild.value === '') {
                nameChild.value = '~';
                stats.n8_pin_name_empty++;
            }
        }
    }

    // N9: Remove (variant ...) from (path ...) nodes inside instances
    // K10 variants feature adds (variant (name "...") (in_bom yes)) to path nodes;
    // K9 only expects reference, unit, value, footprint inside path.
    if (node.name === 'path') {
        const removed = removeAllChildren(node, 'variant');
        if (removed > 0) {
            stats.n9_variant += removed;
        }
    }

    for (const child of node.children) {
        transformK10toK9(child, stats, log, warnings, isTopLibSymbol);
    }
}

// ============================================================
//  KiCad 9 → KiCad 8 Conversion
// ============================================================

async function applyK9toK8(ast, log, warnings) {
    const stats = {
        r1_header: false,
        r2_pin_names_hide: 0,
        r3_pin_hide: 0,
        r4_embedded_fonts: 0,
        r5_sheet_pin_uuid: 0,
        r6_sheet_attrs: 0,
        r7_k9_elements: 0,
        r8_text_box_attrs: 0,
    };

    // R1: Header
    setChildValue(ast, 'version', VERSIONS.KICAD8.version);
    setChildValue(ast, 'generator_version', VERSIONS.KICAD8.generatorVersion);
    stats.r1_header = true;
    log.push(`R1: Version → ${VERSIONS.KICAD8.version}, generator_version → "${VERSIONS.KICAD8.generatorVersion}"`);

    // R2-R8: Recursive transformation
    transformK9toK8(ast, stats, log, warnings);

    // R4: Remove top-level embedded_fonts
    const removedTopFonts = removeAllChildren(ast, 'embedded_fonts');
    if (removedTopFonts > 0) {
        stats.r4_embedded_fonts += removedTopFonts;
        log.push(`R4: Removed ${removedTopFonts} top-level (embedded_fonts) element(s)`);
    }

    // R7: Remove top-level K9-only elements
    const k9Elements = ['table', 'rule_area', 'embedded_files', 'group'];
    for (const elemName of k9Elements) {
        const removed = removeAllChildren(ast, elemName);
        if (removed > 0) {
            stats.r7_k9_elements += removed;
            log.push(`R7: Removed ${removed} top-level (${elemName}) element(s)`);
            warnings.push(`Removed ${removed} (${elemName}) element(s) - KiCad 9 only feature`);
        }
    }

    // Summary
    log.push('--- K9→K8 Summary ---');
    log.push(`R1 Header downgraded: ${stats.r1_header ? 'Yes' : 'No'}`);
    log.push(`R2 pin_names hide converted: ${stats.r2_pin_names_hide}`);
    log.push(`R3 pin hide converted: ${stats.r3_pin_hide}`);
    log.push(`R4 embedded_fonts removed: ${stats.r4_embedded_fonts}`);
    log.push(`R5 sheet pin uuid reordered: ${stats.r5_sheet_pin_uuid}`);
    log.push(`R6 sheet attributes removed: ${stats.r6_sheet_attrs}`);
    log.push(`R7 K9-only elements removed: ${stats.r7_k9_elements}`);
    log.push(`R8 text/text_box attributes removed: ${stats.r8_text_box_attrs}`);
}

function transformK9toK8(node, stats, log, warnings) {
    if (!node || node.type !== 'list') return;

    if (node.name === 'pin_names' || node.name === 'pin_numbers') {
        applyRule2(node, stats, log);
    }

    if (node.name === 'pin') {
        applyRule3(node, stats, log);
    }

    if (node.name === 'symbol' && node.children.length > 0) {
        const removedFonts = removeAllChildren(node, 'embedded_fonts');
        if (removedFonts > 0) {
            stats.r4_embedded_fonts += removedFonts;
        }
    }

    if (node.name === 'sheet') {
        applyRule5(node, stats, log);
        applyRule6(node, stats, log);
    }

    if (node.name === 'text_box') {
        applyRule8TextBox(node, stats, log);
    }
    if (node.name === 'text' || node.name === 'text_box') {
        applyRule8ExcludeFromSim(node, stats, log);
    }

    // Strip K10 variant nodes that may have survived in K9 files
    if (node.name === 'path') {
        removeAllChildren(node, 'variant');
    }

    for (const child of node.children) {
        transformK9toK8(child, stats, log, warnings);
    }
}

// K9→K8 Rule functions (unchanged logic)

function applyRule2(node, stats, log) {
    const hideNode = findChild(node, 'hide');
    if (!hideNode) return;
    const hideValue = hideNode.children.length > 0 ? hideNode.children[0].value : 'yes';
    removeChild(node, 'hide');
    if (hideValue === 'yes') {
        node.children.push({ type: 'atom', value: 'hide' });
        stats.r2_pin_names_hide++;
    }
}

function applyRule3(node, stats, log) {
    const hideIdx = node.children.findIndex(c => c.type === 'list' && c.name === 'hide');
    if (hideIdx < 0) return;
    const hideNode = node.children[hideIdx];
    const hideValue = hideNode.children.length > 0 ? hideNode.children[0].value : 'yes';
    node.children.splice(hideIdx, 1);
    if (hideValue === 'yes') {
        node.children.splice(hideIdx, 0, { type: 'atom', value: 'hide' });
        stats.r3_pin_hide++;
    }
}

function applyRule5(sheetNode, stats, log) {
    const pinNodes = findChildren(sheetNode, 'pin');
    for (const pinNode of pinNodes) {
        const uuidIdx = pinNode.children.findIndex(c => c.type === 'list' && c.name === 'uuid');
        const effectsIdx = pinNode.children.findIndex(c => c.type === 'list' && c.name === 'effects');
        if (uuidIdx >= 0 && effectsIdx >= 0 && uuidIdx < effectsIdx) {
            const [uuidNode] = pinNode.children.splice(uuidIdx, 1);
            const newEffectsIdx = pinNode.children.findIndex(c => c.type === 'list' && c.name === 'effects');
            pinNode.children.splice(newEffectsIdx + 1, 0, uuidNode);
            stats.r5_sheet_pin_uuid++;
        }
    }
}

function applyRule6(sheetNode, stats, log) {
    const attrsToRemove = ['exclude_from_sim', 'in_bom', 'on_board', 'dnp'];
    for (const attr of attrsToRemove) {
        const removed = removeAllChildren(sheetNode, attr);
        if (removed > 0) {
            stats.r6_sheet_attrs += removed;
        }
    }
}

function applyRule8TextBox(node, stats, log) {
    const removed = removeAllChildren(node, 'margins');
    if (removed > 0) {
        stats.r8_text_box_attrs += removed;
    }
}

function applyRule8ExcludeFromSim(node, stats, log) {
    const removed = removeAllChildren(node, 'exclude_from_sim');
    if (removed > 0) {
        stats.r8_text_box_attrs += removed;
    }
}

// ============================================================
//  KiCad 8 → KiCad 7 Conversion
// ============================================================

async function applyK8toK7(ast, log, warnings) {
    const stats = {
        r10_header: false,
        r11_exclude_from_sim: 0,
        r12_description: 0,
        r13_hide_syntax: 0,
        r14_fields_autoplaced: 0,
        r15_image_converted: 0,
    };

    // R10: Header downgrade
    setChildValue(ast, 'version', VERSIONS.KICAD7.version);
    removeChild(ast, 'generator_version');

    // Unquote generator: change from string to atom
    const generatorNode = findChild(ast, 'generator');
    if (generatorNode && generatorNode.children.length > 0) {
        const genChild = generatorNode.children[0];
        if (genChild.type === 'string') {
            genChild.type = 'atom';
        }
    }
    stats.r10_header = true;
    log.push(`R10: Version → ${VERSIONS.KICAD7.version}, removed generator_version, unquoted generator`);

    // R11-R14: Recursive transformation (synchronous)
    transformK8toK7(ast, stats, log, warnings);

    // R15: Convert non-PNG image data to PNG (async, requires Canvas)
    await convertImagesToPng(ast, stats, log, warnings);

    // Summary
    log.push('--- K8→K7 Summary ---');
    log.push(`R10 Header downgraded: ${stats.r10_header ? 'Yes' : 'No'}`);
    log.push(`R11 exclude_from_sim removed: ${stats.r11_exclude_from_sim}`);
    log.push(`R12 Description properties removed: ${stats.r12_description}`);
    log.push(`R13 list→atom keywords converted: ${stats.r13_hide_syntax}`);
    log.push(`R14 fields_autoplaced/dnp fixed: ${stats.r14_fields_autoplaced}`);
    log.push(`R15 images converted to PNG: ${stats.r15_image_converted}`);
}

function transformK8toK7(node, stats, log, warnings) {
    if (!node || node.type !== 'list') return;

    // R11: Remove exclude_from_sim from ALL nodes
    // KiCad 7 does not have exclude_from_sim anywhere
    {
        const removed = removeAllChildren(node, 'exclude_from_sim');
        if (removed > 0) {
            stats.r11_exclude_from_sim += removed;
        }
    }

    // R12: Remove Description property from lib_symbol definitions
    // In K8, lib_symbols have (property "Description" "..." ...) that K7 doesn't have
    if (node.name === 'symbol') {
        const removed = removePropertyByName(node, 'Description');
        if (removed > 0) {
            stats.r12_description += removed;
        }
    }

    // R13: Convert (hide yes), (bold yes), (italic yes) list syntax to bare atoms
    // KiCad 8 uses list syntax, KiCad 7 uses bare keyword atoms
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
                stats.r13_hide_syntax++;
            }
        }
    }

    // R14: Convert (fields_autoplaced yes) → (fields_autoplaced) and remove (dnp ...)
    // KiCad 7 uses (fields_autoplaced) as a bare flag without value
    // KiCad 7 does not have (dnp) attribute on symbol instances
    if (node.name === 'fields_autoplaced') {
        // Remove the 'yes' child, making it a bare (fields_autoplaced) node
        node.children = node.children.filter(c => !(c.type === 'atom' && (c.value === 'yes' || c.value === 'no')));
        stats.r14_fields_autoplaced++;
    }

    // Remove dnp from symbol instances (K7 doesn't have it)
    {
        const removed = removeAllChildren(node, 'dnp');
        if (removed > 0) {
            stats.r14_fields_autoplaced += removed;
        }
    }

    for (const child of node.children) {
        transformK8toK7(child, stats, log, warnings);
    }
}

// ============================================================
//  R15: Image BMP → PNG Conversion
// ============================================================

/**
 * Collect all (image (data ...)) nodes from the AST and convert
 * non-PNG image data (e.g. BMP) to PNG format using Canvas API.
 */
async function convertImagesToPng(ast, stats, log, warnings) {
    const imageNodes = [];
    collectImageNodes(ast, imageNodes);

    for (const imageNode of imageNodes) {
        const dataNode = findChild(imageNode, 'data');
        if (!dataNode || dataNode.children.length === 0) continue;

        // Reassemble base64 string from all children
        const base64Fragments = dataNode.children
            .filter(c => c.type === 'string' || c.type === 'atom')
            .map(c => c.value);
        const fullBase64 = base64Fragments.join('');

        // Check if it's already PNG (PNG magic: iVBOR = base64 of 0x89 0x50 0x4E 0x47)
        if (fullBase64.startsWith('iVBOR')) {
            continue; // Already PNG
        }

        // Check if it's BMP (BMP magic: Qk0 or Qk3 = base64 of 'BM')
        const isBmp = fullBase64.startsWith('Qk');
        const format = isBmp ? 'BMP' : 'unknown';

        log.push(`R15: Found ${format} image data (${fullBase64.length} base64 chars), converting to PNG...`);

        try {
            const pngBase64 = await convertBitmapToPng(fullBase64, isBmp ? 'image/bmp' : 'image/bmp');

            // Replace data node children with new PNG base64 fragments
            // Split into ~76 char chunks (standard base64 line length)
            const chunkSize = 76;
            const newChildren = [];
            for (let i = 0; i < pngBase64.length; i += chunkSize) {
                newChildren.push({
                    type: 'string',
                    value: pngBase64.substring(i, i + chunkSize),
                });
            }
            dataNode.children = newChildren;

            stats.r15_image_converted++;
            log.push(`R15: Converted to PNG (${pngBase64.length} base64 chars, ${newChildren.length} fragments)`);
        } catch (err) {
            warnings.push(`Failed to convert image to PNG: ${err.message}`);
            log.push(`R15: WARNING - Image conversion failed: ${err.message}`);
        }
    }
}

/**
 * Recursively collect all (image ...) nodes from the AST.
 */
function collectImageNodes(node, result) {
    if (!node || node.type !== 'list') return;
    if (node.name === 'image') {
        result.push(node);
        return;
    }
    for (const child of node.children) {
        collectImageNodes(child, result);
    }
}

/**
 * Convert a bitmap (BMP/other) base64 string to PNG base64 string using Canvas API.
 * @param {string} base64Data - base64-encoded image data
 * @param {string} mimeType - MIME type of the source image
 * @returns {Promise<string>} - base64-encoded PNG data (without data URI prefix)
 */
function convertBitmapToPng(base64Data, mimeType) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const dataUrl = canvas.toDataURL('image/png');
                // Strip "data:image/png;base64," prefix
                const pngBase64 = dataUrl.split(',')[1];
                resolve(pngBase64);
            } catch (err) {
                reject(new Error(`Canvas conversion failed: ${err.message}`));
            }
        };
        img.onerror = () => {
            reject(new Error(`Failed to load image as ${mimeType}`));
        };
        img.src = `data:${mimeType};base64,${base64Data}`;
    });
}

// ============================================================
//  KiCad 7 → KiCad 6 Conversion (Schematic, R20-series rules)
// ============================================================
//
// KiCad 7 introduced several schematic-format changes over KiCad 6. The main
// structural one is symbol instancing: K7 stores per-symbol/per-sheet
// (instances (project ...)) blocks, while K6 keeps a single global
// (symbol_instances ...) + (sheet_instances ...) table at the root and tags
// each placed-symbol property with an (id N). This conversion rebuilds that
// legacy table and re-adds the property ids, then strips K7-only features.
//
// NOTE: K6 hierarchical instance paths are reconstructed heuristically from the
// K7 (instances) data; deeply nested hierarchies should be re-opened in KiCad 6
// to confirm reference designators survived. Verify output in KiCad 6.

const STD_PROPERTY_IDS = {
    'Reference': 0, 'Value': 1, 'Footprint': 2, 'Datasheet': 3,
    'ki_keywords': 4, 'ki_description': 5, 'ki_fp_filters': 6,
};

async function applyK7toK6(ast, log, warnings) {
    const stats = {
        r20_header: false,
        r21_k7_features: 0,
        r21b_root_drawings: 0,
        r22_exclude_from_sim: 0,
        r23_dnp_assembly: 0,
        r24_pin_attrs: 0,
        r25_pin_uuid_blocks: 0,
        r26_property_ids: 0,
        r27_sheet_properties: 0,
        r28_instances: 0,
        r29_per_object_instances: 0,
        r30_fill_colors: 0,
    };

    // R20: Header downgrade (version → 20211123; K7 schematics have no generator_version)
    setChildValue(ast, 'version', VERSIONS.KICAD6.version);
    removeChild(ast, 'generator_version');
    stats.r20_header = true;
    log.push(`R20: Version → ${VERSIONS.KICAD6.version}, removed generator_version`);

    // R21: Remove K7-only features that K6 cannot represent (lossy)
    const k7Features = ['text_box', 'textbox', 'simulation_model', 'sim_model', 'netclass_flag', 'directive_label'];
    for (const name of k7Features) {
        const removed = removeDescendantsByName(ast, name);
        if (removed > 0) {
            stats.r21_k7_features += removed;
            warnings.push(`Removed ${removed} (${name}) element(s) - KiCad 7 feature not available in KiCad 6`);
        }
    }

    // R21b: Remove root-level graphic drawings (rectangle, circle, polyline, arc, bezier)
    // KiCad 6 schematics do not support root-level graphic drawing primitives
    const rootDrawings = ['rectangle', 'circle', 'polyline', 'arc', 'bezier'];
    if (ast && ast.children) {
        const beforeCount = ast.children.length;
        ast.children = ast.children.filter(c => !(c.type === 'list' && rootDrawings.includes(c.name)));
        const removed = beforeCount - ast.children.length;
        if (removed > 0) {
            stats.r21b_root_drawings += removed;
            warnings.push(`Removed ${removed} root-level graphic drawing(s) (rectangle/circle/polyline/arc/bezier) - not supported in KiCad 6 schematics`);
        }
    }

    // R28: Rebuild the legacy global symbol/sheet instance table (before removing
    // the per-object (instances) blocks that it is derived from).
    stats.r28_instances += buildLegacySchematicInstances(ast, log);

    // R22-R27, R29-R30: recursive transformation
    transformK7toK6(ast, stats, log, warnings);

    // R29: Remove the now-redundant per-object (instances ...) blocks
    stats.r29_per_object_instances += removeDescendantsByName(ast, 'instances');

    // Summary
    log.push('--- K7→K6 Summary ---');
    log.push(`R20 Header downgraded: ${stats.r20_header ? 'Yes' : 'No'}`);
    log.push(`R21 K7-only features removed: ${stats.r21_k7_features}`);
    log.push(`R21b Root-level drawings removed: ${stats.r21b_root_drawings}`);
    log.push(`R22 exclude_from_sim removed: ${stats.r22_exclude_from_sim}`);
    log.push(`R23 symbol/sheet dnp+assembly flags removed: ${stats.r23_dnp_assembly}`);
    log.push(`R24 pin hide/alternate removed: ${stats.r24_pin_attrs}`);
    log.push(`R25 placed-symbol pin uuid blocks removed: ${stats.r25_pin_uuid_blocks}`);
    log.push(`R26 legacy property ids added: ${stats.r26_property_ids}`);
    log.push(`R27 sheet property names/ids normalized: ${stats.r27_sheet_properties}`);
    log.push(`R28 symbol_instances table rebuilt: ${stats.r28_instances}`);
    log.push(`R29 per-object instances removed: ${stats.r29_per_object_instances}`);
    log.push(`R30 fill colors downgraded: ${stats.r30_fill_colors}`);
}

function transformK7toK6(node, stats, log, warnings) {
    if (!node || node.type !== 'list') return;

    // R22: Remove exclude_from_sim from ALL nodes (K6 has no simulation exclusion)
    {
        const removed = removeAllChildren(node, 'exclude_from_sim');
        if (removed > 0) stats.r22_exclude_from_sim += removed;
    }

    // R23: Remove (dnp ...) from placed symbols; remove assembly/sim flags from sheets
    if (node.name === 'symbol') {
        const removed = removeAllChildren(node, 'dnp');
        if (removed > 0) stats.r23_dnp_assembly += removed;
    }
    if (node.name === 'sheet') {
        for (const attr of ['exclude_from_sim', 'in_bom', 'on_board', 'dnp']) {
            const removed = removeAllChildren(node, attr);
            if (removed > 0) stats.r23_dnp_assembly += removed;
        }
    }

    // R24: Remove (hide ...) and (alternate ...) list children from lib_symbol pins.
    // K6 pins do not accept these child lists.
    if (node.name === 'pin') {
        for (const attr of ['hide', 'alternate']) {
            const removed = removeAllChildren(node, attr);
            if (removed > 0) stats.r24_pin_attrs += removed;
        }
    }

    // R25: Remove placed-symbol pin uuid blocks: (pin "N" (uuid ...)).
    // These only appear on placed symbol instances (which have a lib_id child).
    if (node.name === 'symbol' && findChild(node, 'lib_id')) {
        const before = node.children.length;
        node.children = node.children.filter(c => !isPlacedPinUuidBlock(c));
        const removed = before - node.children.length;
        if (removed > 0) stats.r25_pin_uuid_blocks += removed;
    }

    // R26/R27: property ids and sheet property normalization
    if (node.name === 'symbol' || node.name === 'sheet') {
        if (node.name === 'sheet') {
            stats.r27_sheet_properties += normalizeKiCad6SheetProperties(node);
        }
        stats.r26_property_ids += ensureKiCad6PropertyIds(node);
    }

    // R30: downgrade K7 (fill (type color) (color ...)) → (fill (type background)).
    // Only act when a (type color) child is present so plain sheet/shape fills that
    // carry an explicit (color ...) without a type are left untouched.
    if (node.name === 'fill') {
        const typeNode = findChild(node, 'type');
        if (typeNode && typeNode.children.length > 0 &&
            String(typeNode.children[0].value).toLowerCase() === 'color') {
            typeNode.children[0].value = 'background';
            const removed = removeAllChildren(node, 'color');
            stats.r30_fill_colors += 1 + removed;
        }
    }

    // R21c: Remove color child from font nodes (KiCad 6 font does not support color)
    if (node.name === 'font') {
        const removed = removeAllChildren(node, 'color');
        if (removed > 0) {
            stats.r21_k7_features += removed;
        }
    }

    for (const child of node.children) {
        transformK7toK6(child, stats, log, warnings);
    }
}

/**
 * True for a placed-symbol pin block of the shape (pin "<atom>" (uuid ...)),
 * i.e. a pin node with exactly two payload children: an atom/string and a uuid list.
 */
function isPlacedPinUuidBlock(node) {
    if (!node || node.type !== 'list' || node.name !== 'pin') return false;
    if (node.children.length !== 2) return false;
    const first = node.children[0];
    const second = node.children[1];
    return (first.type === 'atom' || first.type === 'string') &&
        second.type === 'list' && second.name === 'uuid';
}

/**
 * R26: Ensure standard schematic properties carry their legacy (id N), inserting
 * one (after the name/value, at index ≤3) for any standard property that lacks it.
 * Non-standard custom properties get sequential ids starting at 5, avoiding
 * collisions with ids already used by the symbol/sheet.
 */
function ensureKiCad6PropertyIds(node) {
    let changed = 0;
    const props = node.children.filter(c => c.type === 'list' && c.name === 'property');
    const usedIds = new Set();
    for (const prop of props) {
        const idNode = findChild(prop, 'id');
        if (idNode && idNode.children.length > 0) {
            const n = parseInt(idNode.children[0].value);
            if (!isNaN(n)) usedIds.add(n);
        }
        const name = prop.children[0] ? prop.children[0].value : '';
        if (name in STD_PROPERTY_IDS) usedIds.add(STD_PROPERTY_IDS[name]);
    }

    const insertId = (prop, idValue) => {
        const insertIdx = Math.min(3, prop.children.length);
        prop.children.splice(insertIdx, 0, {
            type: 'list', name: 'id', children: [{ type: 'atom', value: String(idValue) }],
        });
        changed++;
    };

    // Standard properties first.
    for (const prop of props) {
        if (findChild(prop, 'id')) continue;
        const name = prop.children[0] ? prop.children[0].value : '';
        if (name in STD_PROPERTY_IDS) insertId(prop, STD_PROPERTY_IDS[name]);
    }
    // Custom properties next.
    let nextId = 5;
    for (const prop of props) {
        if (findChild(prop, 'id')) continue;
        const name = prop.children[0] ? prop.children[0].value : '';
        if (name in STD_PROPERTY_IDS) continue;
        while (usedIds.has(nextId)) nextId++;
        insertId(prop, nextId);
        usedIds.add(nextId);
        nextId++;
    }
    return changed;
}

/**
 * R27: Normalize sheet property names/ids to KiCad 6 form.
 * "Sheetname"/"Sheet name" → "Sheet name" (id 0); "Sheetfile"/"Sheet file" → "Sheet file" (id 1).
 */
function normalizeKiCad6SheetProperties(sheetNode) {
    let changed = 0;
    for (const prop of sheetNode.children) {
        if (prop.type !== 'list' || prop.name !== 'property') continue;
        if (prop.children.length < 1) continue;
        const nameChild = prop.children[0];
        let legacyName = null, legacyId = null;
        if (nameChild.value === 'Sheetname' || nameChild.value === 'Sheet name') {
            legacyName = 'Sheet name'; legacyId = 0;
        } else if (nameChild.value === 'Sheetfile' || nameChild.value === 'Sheet file') {
            legacyName = 'Sheet file'; legacyId = 1;
        } else {
            continue;
        }
        if (nameChild.value !== legacyName) { nameChild.value = legacyName; changed++; }
        const idNode = findChild(prop, 'id');
        if (idNode) {
            if (idNode.children.length > 0 && idNode.children[0].value !== String(legacyId)) {
                idNode.children[0].value = String(legacyId);
                changed++;
            }
        } else {
            const insertIdx = Math.min(3, prop.children.length);
            prop.children.splice(insertIdx, 0, {
                type: 'list', name: 'id', children: [{ type: 'atom', value: String(legacyId) }],
            });
            changed++;
        }
    }
    return changed;
}

/**
 * R28: Rebuild the KiCad 6 global (symbol_instances ...) + (sheet_instances ...)
 * tables at the root from the per-object KiCad 7 (instances (project ...)) blocks.
 * KiCad 7 subsheet files keep no root sheet_instances (only the top sheet does), so
 * we synthesize one here. Returns 0 (no change) when there are no placed symbols and
 * no child sheets to describe.
 */
function buildLegacySchematicInstances(root, log) {
    if (!root || root.type !== 'list' || root.name !== 'kicad_sch') return 0;

    const rootUuid = getChildValue(root, 'uuid') || '';

    const sheetEntries = [];
    const symbolPaths = [];

    for (const child of root.children) {
        if (child.type !== 'list') continue;
        if (child.name === 'symbol' && findChild(child, 'lib_id')) {
            const p = symbolInstancePathNode(child, rootUuid);
            if (p) symbolPaths.push(p);
        } else if (child.name === 'sheet') {
            const sp = sheetInstancePathNode(child);
            if (sp) sheetEntries.push(sp);
        }
    }

    if (symbolPaths.length === 0 && sheetEntries.length === 0) return 0;

    // sheet_instances always starts with the root page entry, then one per child sheet.
    const sheetInstances = {
        type: 'list', name: 'sheet_instances',
        children: [mkPath('/', [mkField('page', '1', true)]), ...sheetEntries],
    };

    let changed = 1;
    changed += removeAllChildren(root, 'sheet_instances');
    changed += removeAllChildren(root, 'symbol_instances');
    root.children.push(sheetInstances);
    if (symbolPaths.length > 0) {
        root.children.push({ type: 'list', name: 'symbol_instances', children: symbolPaths });
    }
    log.push(`R28: Rebuilt sheet_instances + symbol_instances (${symbolPaths.length} symbol(s))`);
    return changed;
}

function mkField(name, value, quoted) {
    return { type: 'list', name, children: [{ type: quoted ? 'string' : 'atom', value: String(value) }] };
}

function mkPath(pathStr, fieldNodes) {
    return { type: 'list', name: 'path', children: [{ type: 'string', value: pathStr }, ...fieldNodes] };
}

/** First (instances)→(project)→(path) node of an object, or null. */
function firstProjectInstancePath(objNode) {
    const instances = findChild(objNode, 'instances');
    if (!instances) return null;
    for (const proj of findChildren(instances, 'project')) {
        const path = findChild(proj, 'path');
        if (path) return path;
    }
    // Some files nest the path directly under instances.
    return findChild(instances, 'path');
}

/** Strip a leading "/<rootUuid>" prefix so the path is relative to the root sheet. */
function normalizeLegacySheetPath(pathStr, rootUuid) {
    let p = pathStr || '';
    if (!p.startsWith('/')) p = '/' + p;
    if (rootUuid && p.startsWith('/' + rootUuid)) {
        p = p.slice(('/' + rootUuid).length) || '/';
        if (!p.startsWith('/')) p = '/' + p;
    }
    return p;
}

function appendLegacyInstanceUuid(pathStr, uuid) {
    if (!uuid) return pathStr;
    if (pathStr.endsWith('/' + uuid)) return pathStr;
    return (pathStr === '/' ? '/' : pathStr + '/') + uuid;
}

function symbolPropertyValue(symbolNode, propName) {
    for (const prop of findChildren(symbolNode, 'property')) {
        if (prop.children.length >= 2 && prop.children[0].value === propName) {
            return prop.children[1].value || '';
        }
    }
    return '';
}

function symbolInstancePathNode(symbolNode, rootUuid) {
    const symbolUuid = getChildValue(symbolNode, 'uuid') || '';
    const projPath = firstProjectInstancePath(symbolNode);

    let basePath = projPath ? (projPath.children[0] ? projPath.children[0].value : '') : symbolUuid;
    if (!basePath) return null;
    basePath = normalizeLegacySheetPath(basePath, rootUuid);
    const fullPath = appendLegacyInstanceUuid(basePath, symbolUuid);

    const fromPath = (name) => {
        if (!projPath) return null;
        const n = findChild(projPath, name);
        return n && n.children.length > 0 ? n.children[0].value : null;
    };

    const reference = fromPath('reference') ?? symbolPropertyValue(symbolNode, 'Reference');
    const unit = fromPath('unit') ?? getChildValue(symbolNode, 'unit') ?? '1';
    const value = fromPath('value') ?? symbolPropertyValue(symbolNode, 'Value');
    const footprint = fromPath('footprint') ?? symbolPropertyValue(symbolNode, 'Footprint');

    return mkPath(fullPath, [
        mkField('reference', reference, true),
        mkField('unit', unit, false),
        mkField('value', value, true),
        mkField('footprint', footprint, true),
    ]);
}

function sheetInstancePathNode(sheetNode) {
    const sheetUuid = getChildValue(sheetNode, 'uuid') || '';
    if (!sheetUuid) return null;
    const projPath = firstProjectInstancePath(sheetNode);
    let page = '';
    if (projPath) {
        const pageNode = findChild(projPath, 'page');
        if (pageNode && pageNode.children.length > 0) page = pageNode.children[0].value;
    }
    const fields = page ? [mkField('page', page, true)] : [];
    return mkPath('/' + sheetUuid, fields);
}

/** Recursively remove all list descendants with the given head name. Returns count. */
function removeDescendantsByName(node, name) {
    if (!node || node.type !== 'list') return 0;
    let removed = 0;
    const before = node.children.length;
    node.children = node.children.filter(c => !(c.type === 'list' && c.name === name));
    removed += before - node.children.length;
    for (const child of node.children) {
        removed += removeDescendantsByName(child, name);
    }
    return removed;
}
