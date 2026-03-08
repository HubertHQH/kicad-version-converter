/**
 * KiCad 9 → KiCad 8 Schematic Converter
 * 
 * Converts .kicad_sch files from KiCad 9 format (version >= 20240101)
 * to KiCad 8 format (version 20231120).
 * 
 * Conversion rules:
 * R1: Header version/generator downgrade
 * R2: pin_names hide syntax: (hide yes) → bare hide
 * R3: pin hide syntax: (hide yes) → bare hide  
 * R4: Remove embedded_fonts
 * R5: Sheet pin uuid position (move after effects)
 * R6: Remove sheet new attributes (exclude_from_sim, in_bom, on_board, dnp)
 * R7: Remove K9-only elements (table, rule_area, embedded_files)
 * R8: Remove text_box margins and text/text_box exclude_from_sim
 */

import {
    parseSExpr,
    serializeSExpr,
    findChild,
    findChildren,
    removeChild,
    removeAllChildren,
    setChildValue,
    getChildValue,
} from './sexpr-parser.js';

const KICAD8_VERSION = '20231120';
const KICAD8_GENERATOR_VERSION = '8.0';

/**
 * Main conversion function.
 * @param {string} input - KiCad 9 .kicad_sch file content
 * @returns {{ output: string, log: string[], warnings: string[] }}
 */
export function convertKicad9to8(input) {
    const log = [];
    const warnings = [];

    // Parse
    log.push('Parsing S-expression...');
    const ast = parseSExpr(input);

    if (!ast || ast.name !== 'kicad_sch') {
        throw new Error('Invalid KiCad schematic file: root element must be kicad_sch');
    }

    const inputVersion = getChildValue(ast, 'version');
    const inputGenerator = getChildValue(ast, 'generator_version');
    log.push(`Input version: ${inputVersion}, generator: ${inputGenerator}`);

    if (inputVersion && parseInt(inputVersion) <= parseInt(KICAD8_VERSION)) {
        warnings.push(`File version ${inputVersion} is already KiCad 8 or earlier. No conversion needed.`);
    }

    // Apply conversion rules
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

    // R1: Header version/generator downgrade
    applyRule1(ast, stats, log);

    // R2-R7: Recursive transformation
    transformNode(ast, stats, log, warnings);

    // R4: Remove top-level embedded_fonts
    const removedTopFonts = removeAllChildren(ast, 'embedded_fonts');
    if (removedTopFonts > 0) {
        stats.r4_embedded_fonts += removedTopFonts;
        log.push(`R4: Removed ${removedTopFonts} top-level (embedded_fonts) element(s)`);
    }

    // R7: Remove top-level K9-only elements
    const k9Elements = ['table', 'rule_area', 'embedded_files'];
    for (const elemName of k9Elements) {
        const removed = removeAllChildren(ast, elemName);
        if (removed > 0) {
            stats.r7_k9_elements += removed;
            log.push(`R7: Removed ${removed} top-level (${elemName}) element(s)`);
            warnings.push(`Removed ${removed} (${elemName}) element(s) - KiCad 9 only feature`);
        }
    }

    // Serialize
    log.push('Serializing output...');
    const output = serializeSExpr(ast) + '\n';

    log.push('--- Conversion Summary ---');
    log.push(`R1 Header downgraded: ${stats.r1_header ? 'Yes' : 'No'}`);
    log.push(`R2 pin_names hide converted: ${stats.r2_pin_names_hide}`);
    log.push(`R3 pin hide converted: ${stats.r3_pin_hide}`);
    log.push(`R4 embedded_fonts removed: ${stats.r4_embedded_fonts}`);
    log.push(`R5 sheet pin uuid reordered: ${stats.r5_sheet_pin_uuid}`);
    log.push(`R6 sheet attributes removed: ${stats.r6_sheet_attrs}`);
    log.push(`R7 K9-only elements removed: ${stats.r7_k9_elements}`);
    log.push(`R8 text/text_box attributes removed: ${stats.r8_text_box_attrs}`);

    return { output, log, warnings };
}

/**
 * R1: Header version/generator downgrade
 */
function applyRule1(ast, stats, log) {
    setChildValue(ast, 'version', KICAD8_VERSION);
    setChildValue(ast, 'generator_version', KICAD8_GENERATOR_VERSION);
    stats.r1_header = true;
    log.push(`R1: Version → ${KICAD8_VERSION}, generator_version → "${KICAD8_GENERATOR_VERSION}"`);
}

/**
 * Recursively walk AST and apply transformation rules.
 */
function transformNode(node, stats, log, warnings) {
    if (!node || node.type !== 'list') return;

    // R2: pin_names and pin_numbers hide syntax
    if (node.name === 'pin_names' || node.name === 'pin_numbers') {
        applyRule2(node, stats, log);
    }

    // R3: pin hide syntax (for pins inside symbol definitions in lib_symbols)
    if (node.name === 'pin') {
        applyRule3(node, stats, log);
    }

    // R4: embedded_fonts inside symbol definitions
    if (node.name === 'symbol' && node.children.length > 0) {
        // Check if this is a lib_symbol definition (has embedded_fonts)
        const removedFonts = removeAllChildren(node, 'embedded_fonts');
        if (removedFonts > 0) {
            stats.r4_embedded_fonts += removedFonts;
        }
    }

    // R5: Sheet pin uuid position (inside sheet elements)
    if (node.name === 'sheet') {
        applyRule5(node, stats, log);
        applyRule6(node, stats, log);
    }

    // R8: text_box margins and text/text_box exclude_from_sim
    if (node.name === 'text_box') {
        applyRule8TextBox(node, stats, log);
    }
    if (node.name === 'text' || node.name === 'text_box') {
        applyRule8ExcludeFromSim(node, stats, log);
    }

    // Recurse into children
    for (const child of node.children) {
        transformNode(child, stats, log, warnings);
    }
}

/**
 * R2: Convert pin_names hide from (hide yes) to bare hide token.
 * 
 * KiCad 9:
 *   (pin_names (offset 1.016) (hide yes))
 * KiCad 8:
 *   (pin_names (offset 1.016) hide)
 */
function applyRule2(node, stats, log) {
    const hideNode = findChild(node, 'hide');
    if (!hideNode) return;

    const hideValue = hideNode.children.length > 0 ? hideNode.children[0].value : 'yes';

    // Remove the (hide yes) list node
    removeChild(node, 'hide');

    if (hideValue === 'yes') {
        // Add bare 'hide' atom
        node.children.push({ type: 'atom', value: 'hide' });
        stats.r2_pin_names_hide++;
    }
    // If hide is 'no', we just remove it entirely
}

/**
 * R3: Convert pin hide from (hide yes) to bare hide token.
 * 
 * This handles pin definitions inside lib_symbols.
 * Note: In KiCad S-expressions, the pin node starts with:
 *   (pin TYPE STYLE (at ...) (length L) ...)
 * 
 * KiCad 9:
 *   (pin power_in line (at 0 0 90) (length 0) (hide yes) (name "GND" ...))
 * KiCad 8:
 *   (pin power_in line (at 0 0 90) (length 0) hide (name "GND" ...))
 */
function applyRule3(node, stats, log) {
    const hideIdx = node.children.findIndex(c => c.type === 'list' && c.name === 'hide');
    if (hideIdx < 0) return;

    const hideNode = node.children[hideIdx];
    const hideValue = hideNode.children.length > 0 ? hideNode.children[0].value : 'yes';

    // Remove the (hide yes) list node
    node.children.splice(hideIdx, 1);

    if (hideValue === 'yes') {
        // Insert bare 'hide' atom at the same position
        node.children.splice(hideIdx, 0, { type: 'atom', value: 'hide' });
        stats.r3_pin_hide++;
    }
}

/**
 * R5: Move sheet pin uuid from before effects to after effects.
 * 
 * KiCad 9 (uuid before effects):
 *   (pin "NAME" type (at X Y R) (uuid "...") (effects ...))
 * KiCad 8 (uuid after effects):
 *   (pin "NAME" type (at X Y R) (effects ...) (uuid "..."))
 */
function applyRule5(sheetNode, stats, log) {
    // Find pin children inside the sheet
    const pinNodes = findChildren(sheetNode, 'pin');

    for (const pinNode of pinNodes) {
        const uuidIdx = pinNode.children.findIndex(c => c.type === 'list' && c.name === 'uuid');
        const effectsIdx = pinNode.children.findIndex(c => c.type === 'list' && c.name === 'effects');

        // Only reorder if uuid is BEFORE effects (KiCad 9 style)
        if (uuidIdx >= 0 && effectsIdx >= 0 && uuidIdx < effectsIdx) {
            // Remove uuid from current position
            const [uuidNode] = pinNode.children.splice(uuidIdx, 1);
            // effectsIdx is now shifted by -1 since we removed uuid before it
            // Insert uuid after effects (which is now at effectsIdx - 1)
            const newEffectsIdx = pinNode.children.findIndex(c => c.type === 'list' && c.name === 'effects');
            pinNode.children.splice(newEffectsIdx + 1, 0, uuidNode);
            stats.r5_sheet_pin_uuid++;
        }
    }
}

/**
 * R6: Remove sheet new attributes (KiCad 9 only).
 * Remove: exclude_from_sim, in_bom, on_board, dnp from sheet elements.
 */
function applyRule6(sheetNode, stats, log) {
    const attrsToRemove = ['exclude_from_sim', 'in_bom', 'on_board', 'dnp'];

    for (const attr of attrsToRemove) {
        const removed = removeAllChildren(sheetNode, attr);
        if (removed > 0) {
            stats.r6_sheet_attrs += removed;
        }
    }
}

/**
 * R8a: Remove margins from text_box elements.
 * 
 * KiCad 9:
 *   (text_box "..." (exclude_from_sim no) (at ...) (size ...) (margins 0.9525 0.9525 0.9525 0.9525) ...)
 * KiCad 8:
 *   (text_box "..." (at ...) (size ...) ...)
 */
function applyRule8TextBox(node, stats, log) {
    const removed = removeAllChildren(node, 'margins');
    if (removed > 0) {
        stats.r8_text_box_attrs += removed;
    }
}

/**
 * R8b: Remove exclude_from_sim from top-level text and text_box elements.
 * 
 * In KiCad 9, text and text_box elements can have (exclude_from_sim no).
 * KiCad 8 does not support this attribute on text/text_box.
 */
function applyRule8ExcludeFromSim(node, stats, log) {
    const removed = removeAllChildren(node, 'exclude_from_sim');
    if (removed > 0) {
        stats.r8_text_box_attrs += removed;
    }
}

/**
 * Detect the KiCad version of input text.
 * @param {string} input 
 * @returns {{ version: string, generatorVersion: string, isKicad9: boolean }}
 */
export function detectVersion(input) {
    const versionMatch = input.match(/\(version\s+(\d+)\)/);
    const generatorMatch = input.match(/\(generator_version\s+"([^"]+)"\)/);

    const version = versionMatch ? versionMatch[1] : 'unknown';
    const generatorVersion = generatorMatch ? generatorMatch[1] : 'unknown';
    const isKicad9 = parseInt(version) > parseInt(KICAD8_VERSION);

    return { version, generatorVersion, isKicad9 };
}
