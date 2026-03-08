/**
 * KiCad Multi-Version Schematic Converter
 * 
 * Supports chain-based downgrade conversions:
 *   KiCad 9 → KiCad 8
 *   KiCad 8 → KiCad 7
 *   KiCad 9 → KiCad 7 (chained: 9→8→7)
 * 
 * Conversion rules (K9 → K8):
 *   R1: Header version/generator downgrade
 *   R2: pin_names hide syntax: (hide yes) → bare hide
 *   R3: pin hide syntax: (hide yes) → bare hide  
 *   R4: Remove embedded_fonts
 *   R5: Sheet pin uuid position (move after effects)
 *   R6: Remove sheet new attributes (exclude_from_sim, in_bom, on_board, dnp)
 *   R7: Remove K9-only elements (table, rule_area, embedded_files)
 *   R8: Remove text_box margins and text/text_box exclude_from_sim
 * 
 * Conversion rules (K8 → K7):
 *   R10: Header downgrade (remove generator_version, unquote generator)
 *   R11: Remove exclude_from_sim from lib_symbols and symbol instances
 *   R12: Remove Description property from lib_symbols
 *   R13: Convert (hide/bold/italic yes) to bare atoms in effects/font
 *   R14: Convert (fields_autoplaced yes) → (fields_autoplaced), remove (dnp)
 *   R15: Convert non-PNG image data (BMP) to PNG format
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

// --- Version Definitions ---

const VERSIONS = {
    KICAD7: { version: '20230121', generatorVersion: null, label: 'KiCad 7' },
    KICAD8: { version: '20231120', generatorVersion: '8.0', label: 'KiCad 8' },
    KICAD9: { version: '20250114', generatorVersion: '9.0', label: 'KiCad 9' },
};

// Ordered from newest to oldest
const VERSION_CHAIN = [VERSIONS.KICAD9, VERSIONS.KICAD8, VERSIONS.KICAD7];

/**
 * Detect the KiCad version of input text.
 * @param {string} input 
 * @returns {{ version: string, generatorVersion: string, detectedVersion: object, label: string }}
 */
export function detectVersion(input) {
    const versionMatch = input.match(/\(version\s+(\d+)\)/);
    const generatorMatch = input.match(/\(generator_version\s+"([^"]+)"\)/);

    const version = versionMatch ? versionMatch[1] : 'unknown';
    const generatorVersion = generatorMatch ? generatorMatch[1] : 'unknown';

    // Determine which major version this corresponds to
    const versionNum = parseInt(version);
    let detectedVersion = null;
    let label = 'Unknown';

    if (versionNum > parseInt(VERSIONS.KICAD8.version)) {
        detectedVersion = VERSIONS.KICAD9;
        label = 'KiCad 9';
    } else if (versionNum > parseInt(VERSIONS.KICAD7.version)) {
        detectedVersion = VERSIONS.KICAD8;
        label = 'KiCad 8';
    } else if (versionNum >= 20200310) {
        // S-expression format starts from KiCad 6
        detectedVersion = VERSIONS.KICAD7;
        label = 'KiCad 7';
    } else {
        label = `v${version}`;
    }

    const isKicad9 = versionNum > parseInt(VERSIONS.KICAD8.version);

    return { version, generatorVersion, detectedVersion, label, isKicad9 };
}

/**
 * Main unified conversion function.
 * @param {string} input - KiCad .kicad_sch file content
 * @param {string} targetVersionKey - 'KICAD8' or 'KICAD7'
 * @returns {Promise<{ output: string, log: string[], warnings: string[] }>}
 */
export async function convertKicad(input, targetVersionKey) {
    const targetVersion = VERSIONS[targetVersionKey];
    if (!targetVersion) {
        throw new Error(`Unknown target version: ${targetVersionKey}`);
    }

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

    // Determine input major version
    const inputVersionNum = parseInt(inputVersion);
    const targetVersionNum = parseInt(targetVersion.version);

    if (inputVersionNum <= targetVersionNum) {
        warnings.push(`File version ${inputVersion} is already ${targetVersion.label} or earlier. No conversion needed.`);
    }

    // Determine which conversion steps to apply (chain from input → target)
    const steps = [];
    if (inputVersionNum > parseInt(VERSIONS.KICAD8.version) && targetVersionNum <= parseInt(VERSIONS.KICAD8.version)) {
        steps.push({ from: VERSIONS.KICAD9, to: VERSIONS.KICAD8, fn: applyK9toK8 });
    }
    if (inputVersionNum > parseInt(VERSIONS.KICAD7.version) && targetVersionNum <= parseInt(VERSIONS.KICAD7.version)) {
        steps.push({ from: VERSIONS.KICAD8, to: VERSIONS.KICAD7, fn: applyK8toK7 });
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
        log.push(`\n─── ${step.from.label} → ${step.to.label} ───`);
        await step.fn(ast, log, warnings);
    }

    // Serialize
    log.push('\nSerializing output...');
    const output = serializeSExpr(ast) + '\n';

    return { output, log, warnings };
}

/**
 * Legacy function for backward compatibility.
 */
export async function convertKicad9to8(input) {
    return convertKicad(input, 'KICAD8');
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
    const k9Elements = ['table', 'rule_area', 'embedded_files'];
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
