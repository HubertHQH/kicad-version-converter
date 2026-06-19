/**
 * KiCad 6 (.kicad_sch, S-expression) → KiCad 5 legacy Eeschema schematic writer.
 *
 * Produces a legacy "EESchema Schematic File Version 4" .sch text plus, from the
 * schematic's embedded (lib_symbols ...), a matching <base>-cache.lib / .dcm so
 * the converted sheet can render its symbols in KiCad 5.
 *
 * Coordinate handling: both formats use a Y-down schematic space, so only a
 * millimetre → mil unit change is applied (1 mil = 0.0254 mm); no axis flip.
 *
 * Scope/limitations (lossy, and unvalidated against a real KiCad 5):
 *   - One sheet per file (this is a per-file converter). Reference designators are
 *     read from each symbol's Reference property; cross-sheet instance tables (AR
 *     lines) are not synthesised, so deep hierarchies may need re-annotation.
 *   - Symbol library resolution in KiCad 5 may still require the original
 *     libraries / sym-lib-table; a best-effort cache library is emitted.
 */

import { findChild, findChildren } from './sexpr-parser.js';
import { writeLegacySymbolLib } from './sym-legacy-writer.js';

// ---- units + helpers ----------------------------------------------------------

function mil(mm) {
    const v = parseFloat(mm);
    return isFinite(v) ? Math.round(v / 0.0254) : 0;
}
function num(node, idx) { return node && node.children[idx] ? node.children[idx].value : undefined; }
function atVal(node) {
    const at = findChild(node, 'at');
    return { x: mil(num(at, 0)), y: mil(num(at, 1)), a: Math.round(parseFloat(num(at, 2)) || 0) };
}
/** schematic label/text orientation: angle degrees → legacy 0/1/2/3. */
function orientCode(angle) {
    switch (((angle % 360) + 360) % 360) {
        case 0: return 0; case 90: return 1; case 180: return 2; case 270: return 3; default: return 0;
    }
}
function fontSizeMil(node) {
    const effects = findChild(node, 'effects');
    const font = effects ? findChild(effects, 'font') : null;
    const size = font ? findChild(font, 'size') : null;
    return size && size.children[0] ? mil(size.children[0].value) : 50;
}
function isHidden(propNode) {
    const effects = findChild(propNode, 'effects');
    if (!effects) return false;
    return effects.children.some(c => c.type === 'atom' && c.value === 'hide') ||
        (findChild(effects, 'hide')?.children[0]?.value === 'yes');
}
function justify(propNode) {
    let h = 'C', v = 'C';
    const effects = findChild(propNode, 'effects');
    const j = effects ? findChild(effects, 'justify') : null;
    if (j) for (const c of j.children) {
        if (c.value === 'left') h = 'L'; else if (c.value === 'right') h = 'R';
        else if (c.value === 'top') v = 'T'; else if (c.value === 'bottom') v = 'B';
    }
    return { h, v };
}
function short8(uuid) { return String(uuid || '').replace(/-/g, '').slice(-8).toUpperCase() || '00000000'; }
function escapeText(t) { return String(t ?? '').replace(/\r?\n/g, '\\n'); }

const PAPER = {
    A4: [11693, 8268], A3: [16535, 11693], A2: [23386, 16535], A1: [33110, 23386],
    A0: [46811, 33110], A: [11000, 8500], B: [17000, 11000], C: [22000, 17000],
    D: [34000, 22000], E: [44000, 34000], USLetter: [11000, 8500], USLegal: [14000, 8500],
};
const GLABEL_SHAPE = {
    input: 'Input', output: 'Output', bidirectional: 'BiDi', tri_state: '3State',
    passive: 'UnSpc', unspecified: 'UnSpc',
};
const SHEETPIN_FORM = {
    input: 'I', output: 'O', bidirectional: 'B', tri_state: 'T', passive: 'U', unspecified: 'U',
};

// ---- property access ----------------------------------------------------------

function getProp(node, name) {
    for (const p of findChildren(node, 'property')) {
        if (p.children[0] && p.children[0].value === name) return p;
    }
    return null;
}
function getPropVal(node, name, dflt = '') {
    const p = getProp(node, name);
    return p && p.children[1] ? p.children[1].value : dflt;
}

// ---- component orientation matrix --------------------------------------------

function orientMatrix(angle, mirror) {
    let m;
    switch (((angle % 360) + 360) % 360) {
        case 0: m = [1, 0, 0, -1]; break;
        case 90: m = [0, -1, -1, 0]; break;
        case 180: m = [-1, 0, 0, 1]; break;
        case 270: m = [0, 1, 1, 0]; break;
        default: m = [1, 0, 0, -1];
    }
    // Apply mirror exactly as KiCad's SCH_SYMBOL::SetOrientation does — the angle
    // base matrix multiplied by the mirror temp (m_transform * temp):
    //   SYM_MIRROR_X temp = (x1=1, y2=-1)  → result negates x2,y2
    //   SYM_MIRROR_Y temp = (x1=-1, y2=1)  → result negates x1,y1
    // (verified against KiCad 6 sch_symbol.cpp). m = [x1, y1, x2, y2].
    if (mirror === 'x') m = [m[0], m[1], -m[2], -m[3]];
    else if (mirror === 'y') m = [-m[0], -m[1], m[2], m[3]];
    return m;
}

// ---- $Comp ($EndComp) ---------------------------------------------------------

function compFieldLine(idx, value, propNode, fieldName, fallback) {
    let x = fallback.x, y = fallback.y, size = 50, orient = 'H', vis = '0000', hj = 'C', vj = 'C', it = 'N', bo = 'N';
    if (propNode) {
        const at = findChild(propNode, 'at');
        if (at) {
            x = mil(num(at, 0)); y = mil(num(at, 1));
            orient = (Math.round(parseFloat(num(at, 2)) || 0) % 180 === 90) ? 'V' : 'H';
        }
        size = fontSizeMil(propNode);
        if (isHidden(propNode)) vis = '0001';
        const jj = justify(propNode); hj = jj.h; vj = jj.v;
        const font = findChild(findChild(propNode, 'effects') || {}, 'font');
        if (font) {
            if (font.children.some(c => c.type === 'atom' && c.value === 'italic')) it = 'I';
            if (font.children.some(c => c.type === 'atom' && c.value === 'bold')) bo = 'B';
        }
    }
    let line = `F ${idx} "${escapeText(value)}" ${orient} ${x} ${y} ${size} ${vis} ${hj} ${vj}${it}${bo}`;
    if (idx >= 4) line += ` "${escapeText(fieldName)}"`;
    return line;
}

function writeComponent(sym, out) {
    const libId = (findChild(sym, 'lib_id')?.children[0]?.value) || '';
    const ref = getPropVal(sym, 'Reference', '?');
    const unit = findChild(sym, 'unit')?.children[0]?.value || '1';
    const uuid = findChild(sym, 'uuid')?.children[0]?.value || '';
    const pos = atVal(sym);
    const mirror = findChild(sym, 'mirror')?.children[0]?.value;

    out.push('$Comp');
    out.push(`L ${libId} ${ref}`);
    out.push(`U ${unit} 1 ${short8(uuid)}`);
    out.push(`P ${pos.x} ${pos.y}`);

    const fallback = { x: pos.x, y: pos.y };
    out.push(compFieldLine(0, ref, getProp(sym, 'Reference'), 'Reference', fallback));
    out.push(compFieldLine(1, getPropVal(sym, 'Value', ''), getProp(sym, 'Value'), 'Value', fallback));
    out.push(compFieldLine(2, getPropVal(sym, 'Footprint', ''), getProp(sym, 'Footprint'), 'Footprint', fallback));
    out.push(compFieldLine(3, getPropVal(sym, 'Datasheet', ''), getProp(sym, 'Datasheet'), 'Datasheet', fallback));
    let fIdx = 4;
    const STD = new Set(['Reference', 'Value', 'Footprint', 'Datasheet']);
    for (const p of findChildren(sym, 'property')) {
        const pName = p.children[0] ? p.children[0].value : '';
        if (STD.has(pName)) continue;
        out.push(compFieldLine(fIdx, p.children[1] ? p.children[1].value : '', p, pName, fallback));
        fIdx++;
    }

    out.push(`\t${unit}    ${pos.x} ${pos.y}`);
    const m = orientMatrix(pos.a, mirror);
    out.push(`\t${m[0]}    ${m[1]} ${m[2]} ${m[3]}`);
    out.push('$EndComp');
}

// ---- $Sheet ($EndSheet) -------------------------------------------------------

function writeSheet(sheet, out) {
    const pos = atVal(sheet);
    const size = findChild(sheet, 'size');
    const w = mil(num(size, 0)), h = mil(num(size, 1));
    const uuid = findChild(sheet, 'uuid')?.children[0]?.value || '';
    const name = getPropVal(sheet, 'Sheet name', getPropVal(sheet, 'Sheetname', ''));
    let file = getPropVal(sheet, 'Sheet file', getPropVal(sheet, 'Sheetfile', ''));
    file = file.replace(/\.kicad_sch$/, '.sch');
    const nameProp = getProp(sheet, 'Sheet name') || getProp(sheet, 'Sheetname');
    const fileProp = getProp(sheet, 'Sheet file') || getProp(sheet, 'Sheetfile');

    out.push('$Sheet');
    out.push(`S ${pos.x} ${pos.y} ${w} ${h}`);
    out.push(`U ${short8(uuid)}`);
    out.push(`F0 "${escapeText(name)}" ${nameProp ? fontSizeMil(nameProp) : 50}`);
    out.push(`F1 "${escapeText(file)}" ${fileProp ? fontSizeMil(fileProp) : 50}`);

    let fIdx = 2;
    for (const pin of findChildren(sheet, 'pin')) {
        const pinName = pin.children[0] ? pin.children[0].value : '';
        const shapeRaw = pin.children[1] && pin.children[1].type === 'atom' ? pin.children[1].value : 'input';
        const form = SHEETPIN_FORM[shapeRaw] || 'U';
        const p = atVal(pin);
        // Side letter from the pin angle (best effort; sheet pins are usually L/R).
        const side = { 0: 'R', 90: 'T', 180: 'L', 270: 'B' }[((p.a % 360) + 360) % 360] || 'R';
        out.push(`F${fIdx} "${escapeText(pinName)}" ${form} ${side} ${p.x} ${p.y} ${fontSizeMil(pin)}`);
        fIdx++;
    }
    out.push('$EndSheet');
}

// ---- wires / labels / etc -----------------------------------------------------

function ptsOf(node) {
    const pts = findChild(node, 'pts');
    return pts ? findChildren(pts, 'xy').map(xy => ({ x: mil(num(xy, 0)), y: mil(num(xy, 1)) })) : [];
}

function writeWireLike(node, kind, out) {
    const p = ptsOf(node);
    if (p.length < 2) return;
    out.push(`Wire ${kind} Line`);
    out.push(`\t${p[0].x} ${p[0].y} ${p[1].x} ${p[1].y}`);
}

function writeLabel(node, legacyKind, out) {
    const text = node.children[0] ? node.children[0].value : '';
    const pos = atVal(node);
    const size = fontSizeMil(node);
    let orient = orientCode(pos.a); // local/text encoding: 0:0 90:1 180:2 270:3
    // KiCad stores GLabel/HLabel orientation with 0<->2 swapped vs local labels
    // (sch_legacy_plugin loadText comment table: Global vs Local "Left/Right justified").
    // Without this, directional labels' pennants point the wrong way.
    const directional = (legacyKind === 'GLabel' || legacyKind === 'HLabel');
    if (directional) orient = (orient === 0) ? 2 : (orient === 2) ? 0 : orient;
    if (legacyKind === 'Label' || legacyKind === 'Notes') {
        out.push(`Text ${legacyKind} ${pos.x} ${pos.y} ${orient}    ${size}   ~ 0`);
    } else {
        const shapeRaw = findChild(node, 'shape')?.children[0]?.value || 'input';
        const shape = GLABEL_SHAPE[shapeRaw] || 'UnSpc';
        out.push(`Text ${legacyKind} ${pos.x} ${pos.y} ${orient}    ${size}   ${shape} ~ 0`);
    }
    out.push(escapeText(text));
}

// ---- main entry ---------------------------------------------------------------

/**
 * Convert a parsed .kicad_sch AST to a legacy .sch plus optional cache library.
 * @returns {{ sch: string, cacheLib: string|null, cacheDcm: string|null }}
 */
export function writeLegacySchematic(ast, baseName, warnings = [], cacheBaseName = baseName) {
    const out = [];

    // Header — LIBS points at the (possibly shared, root-named) project cache.
    out.push('EESchema Schematic File Version 4');
    out.push(`LIBS:${cacheBaseName}-cache`);
    out.push('EELAYER 30 0');
    out.push('EELAYER END');

    // $Descr
    const paperNode = findChild(ast, 'paper');
    const paperName = paperNode && paperNode.children[0] ? paperNode.children[0].value : 'A4';
    const portrait = paperNode && paperNode.children.some(c => c.value === 'portrait');
    let [pw, ph] = PAPER[paperName] || PAPER.A4;
    if (portrait) [pw, ph] = [ph, pw];
    out.push(`$Descr ${paperName} ${pw} ${ph}${portrait ? ' portrait' : ''}`);
    out.push('encoding utf-8');
    out.push('Sheet 1 1');
    const tb = findChild(ast, 'title_block');
    const tbVal = (name) => {
        if (!tb) return '';
        const n = findChild(tb, name);
        return n && n.children[0] ? n.children[0].value : '';
    };
    out.push(`Title "${escapeText(tbVal('title'))}"`);
    out.push(`Date "${escapeText(tbVal('date'))}"`);
    out.push(`Rev "${escapeText(tbVal('rev'))}"`);
    out.push(`Comp "${escapeText(tbVal('company'))}"`);
    for (let i = 1; i <= 4; i++) {
        let c = '';
        if (tb) {
            for (const cm of findChildren(tb, 'comment')) {
                if (cm.children[0] && cm.children[0].value === String(i)) c = cm.children[1]?.value || '';
            }
        }
        out.push(`Comment${i} "${escapeText(c)}"`);
    }
    out.push('$EndDescr');

    // Body — iterate root children in document order
    for (const node of ast.children) {
        if (node.type !== 'list') continue;
        switch (node.name) {
            case 'wire': writeWireLike(node, 'Wire', out); break;
            case 'bus': writeWireLike(node, 'Bus', out); break;
            case 'polyline': writeWireLike(node, 'Notes', out); break; // defensive (graphic line)
            case 'bus_entry': {
                const pos = atVal(node);
                const sz = findChild(node, 'size');
                const dx = mil(num(sz, 0)), dy = mil(num(sz, 1));
                out.push('Entry Wire Line');
                out.push(`\t${pos.x} ${pos.y} ${pos.x + dx} ${pos.y + dy}`);
                break;
            }
            case 'junction': { const p = atVal(node); out.push(`Connection ~ ${p.x} ${p.y}`); break; }
            case 'no_connect': { const p = atVal(node); out.push(`NoConn ~ ${p.x} ${p.y}`); break; }
            case 'label': writeLabel(node, 'Label', out); break;
            case 'global_label': writeLabel(node, 'GLabel', out); break;
            case 'hierarchical_label': writeLabel(node, 'HLabel', out); break;
            case 'text': writeLabel(node, 'Notes', out); break;
            case 'symbol': writeComponent(node, out); break;
            case 'sheet': writeSheet(node, out); break;
            default: break; // lib_symbols, sheet_instances, symbol_instances, uuid, paper, title_block...
        }
    }

    out.push('$EndSCHEMATC');
    out.push('');

    // Cache library from embedded lib_symbols
    let cacheLib = null, cacheDcm = null;
    const libSymbols = findChild(ast, 'lib_symbols');
    if (libSymbols && findChildren(libSymbols, 'symbol').length > 0) {
        const synthetic = { type: 'list', name: 'kicad_symbol_lib', children: libSymbols.children };
        // cacheNames: emit DEF/ALIAS as `libnick_Sym` so the schematic's
        // `L libnick:Sym` lib_ids resolve against this cache the way KiCad 5 expects.
        const { lib, dcm } = writeLegacySymbolLib(synthetic, warnings, { cacheNames: true });
        cacheLib = lib;
        cacheDcm = dcm;
    } else {
        warnings.push('Schematic has no embedded symbols; no cache library generated. Symbol graphics may not render in KiCad 5 without the original libraries.');
    }

    return { sch: out.join('\n'), cacheLib, cacheDcm };
}
