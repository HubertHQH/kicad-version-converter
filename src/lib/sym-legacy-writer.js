/**
 * KiCad 6 (.kicad_sym, S-expression) → KiCad 5 legacy symbol library writer.
 *
 * Emits two legacy text files from a modern symbol-library AST:
 *   - .lib  : "EESchema-LIBRARY Version 2.4" — DEF/F0-Fn/ALIAS/$FPLIST/DRAW(.../X pins)/ENDDEF
 *   - .dcm  : "EESchema-DOCLIB Version 2.0" — $CMP/D/K/F documentation records
 *
 * Coordinate handling: both formats use a Y-up symbol coordinate space, so only a
 * millimetre → mil unit change is applied (1 mil = 0.0254 mm); no axis flip.
 *
 * Modern features without a legacy equivalent are dropped with a warning. The
 * geometry/format choices follow the AskStr/kicad-backport-cplus reference but
 * could not be validated against a real KiCad 5; verify converted libraries.
 *
 * This module is also reused by the schematic writer to emit a <name>-cache.lib
 * from a schematic's embedded (lib_symbols ...).
 */

import { findChild, findChildren } from './sexpr-parser.js';

// ---- unit + small helpers ----------------------------------------------------

/** millimetres → integer mils (legacy library internal unit). */
function mil(mm) {
    const v = parseFloat(mm);
    return isFinite(v) ? Math.round(v / 0.0254) : 0;
}
function deci(deg) {
    const v = parseFloat(deg);
    return isFinite(v) ? Math.round(v * 10) : 0;
}
function num(node, idx) {
    return node && node.children[idx] ? node.children[idx].value : undefined;
}
/** strip a "libname:" prefix and replace spaces (legacy names are whitespace-free). */
function legacyName(name) {
    let n = String(name || '');
    const colon = n.indexOf(':');
    if (colon >= 0) n = n.slice(colon + 1);
    return n.replace(/\s+/g, '~') || '~';
}

/**
 * The DEF/ALIAS/$CMP name to emit for a symbol.
 *  - Standalone .kicad_sym → .lib (default): bare item name (the user re-assigns a
 *    nickname via sym-lib-table, so symbols are addressed by item name).
 *  - Cache mode (`cacheNames`): the *full* lib id with the colon turned into an
 *    underscore — this is exactly the key KiCad 5 builds when it falls back to the
 *    project cache (`SCH_COMPONENT::Resolve`: lib id formatted, then ":" → "_"),
 *    so `L libnick:Sym` resolves to cache symbol `libnick_Sym`.
 */
function outName(name, cacheNames) {
    if (!cacheNames) return legacyName(name);
    return String(name || '').replace(/:/g, '_').replace(/\s+/g, '~') || '~';
}
function q(text) {
    // Legacy double-quoted field; legacy parsers don't support escaped quotes well.
    return '"' + String(text ?? '').replace(/"/g, "''") + '"';
}

const PIN_ETYPE = {
    input: 'I', output: 'O', bidirectional: 'B', tri_state: 'T', passive: 'P',
    free: 'U', unspecified: 'U', power_in: 'W', power_out: 'w',
    open_collector: 'C', open_emitter: 'E', no_connect: 'N',
};
const PIN_SHAPE = {
    line: '', inverted: 'I', clock: 'C', inverted_clock: 'IC',
    input_low: 'L', clock_low: 'CL', output_low: 'V',
    edge_clock_high: 'C', falling_edge_clock: 'F', non_logic: 'X',
};
function pinDir(angle) {
    switch (Math.round(parseFloat(angle) || 0) % 360) {
        case 0: return 'R';
        case 90: return 'U';
        case 180: return 'L';
        case 270: case -90: return 'D';
        default: return 'R';
    }
}
function fillChar(node) {
    const fill = findChild(node, 'fill');
    if (!fill) return 'N';
    const type = findChild(fill, 'type');
    const v = type && type.children[0] ? type.children[0].value : 'none';
    if (v === 'background') return 'f';
    if (v === 'outline') return 'F';
    return 'N';
}
function strokeWidthMil(node) {
    const stroke = findChild(node, 'stroke');
    if (stroke) {
        const w = findChild(stroke, 'width');
        if (w && w.children[0]) return mil(w.children[0].value);
    }
    return 0;
}
/** Text height in mil from a node carrying (effects (font (size H W))); default 50. */
function effectsFontSizeMil(node) {
    if (!node) return 50;
    const effects = findChild(node, 'effects');
    const font = effects ? findChild(effects, 'font') : null;
    const size = font ? findChild(font, 'size') : null;
    return size && size.children[0] ? mil(size.children[0].value) : 50;
}

// ---- property access ----------------------------------------------------------

function getProp(symNode, propName) {
    for (const p of findChildren(symNode, 'property')) {
        if (p.children[0] && p.children[0].value === propName) return p;
    }
    return null;
}
function getPropValue(symNode, propName, dflt = '') {
    const p = getProp(symNode, propName);
    return p && p.children[1] ? p.children[1].value : dflt;
}

// ---- field (F) line -----------------------------------------------------------

/**
 * Build a legacy F-line. idx 0..3 are the standard fields (no trailing name);
 * idx>=4 are custom fields and carry the quoted field name.
 */
function fieldLine(idx, value, propNode, fieldName) {
    let x = 0, y = 0, size = 50, orient = 'H', visible = 'V', hjust = 'C', vjust = 'C', italic = 'N', bold = 'N';
    if (propNode) {
        const at = findChild(propNode, 'at');
        if (at) {
            x = mil(num(at, 0)); y = mil(num(at, 1));
            const a = Math.round(parseFloat(num(at, 2)) || 0) % 180;
            orient = (a === 90) ? 'V' : 'H';
        }
        const effects = findChild(propNode, 'effects');
        if (effects) {
            const font = findChild(effects, 'font');
            if (font) {
                const sz = findChild(font, 'size');
                if (sz && sz.children[0]) size = mil(sz.children[0].value);
                if (font.children.some(c => c.type === 'atom' && c.value === 'italic')) italic = 'I';
                if (font.children.some(c => c.type === 'atom' && c.value === 'bold')) bold = 'B';
            }
            // (effects ... hide) — bare atom or (hide yes)
            const hidden = effects.children.some(c => c.type === 'atom' && c.value === 'hide') ||
                (findChild(effects, 'hide')?.children[0]?.value === 'yes');
            if (hidden) visible = 'I';
            const justify = findChild(effects, 'justify');
            if (justify) {
                for (const c of justify.children) {
                    if (c.value === 'left') hjust = 'L';
                    else if (c.value === 'right') hjust = 'R';
                    else if (c.value === 'top') vjust = 'T';
                    else if (c.value === 'bottom') vjust = 'B';
                }
            }
        }
    }
    let line = `F${idx} ${q(value)} ${x} ${y} ${size} ${orient} ${visible} ${hjust} ${vjust}${italic}${bold}`;
    if (idx >= 4) line += ` ${q(fieldName)}`;
    return line;
}

// ---- pin + graphics -----------------------------------------------------------

function pinLine(pin, unit, convert) {
    // (pin <etype> <style> (at x y angle) (length L) [hide] (name "..") (number "..") )
    const etypeRaw = pin.children.find(c => c.type === 'atom' && PIN_ETYPE[c.value]);
    const styleRaw = pin.children.find((c, i) => c.type === 'atom' && i >= 1 && PIN_SHAPE[c.value] !== undefined && c !== etypeRaw);
    const etype = etypeRaw ? PIN_ETYPE[etypeRaw.value] : 'U';
    let shape = styleRaw ? PIN_SHAPE[styleRaw.value] : '';
    const at = findChild(pin, 'at');
    const x = mil(num(at, 0)), y = mil(num(at, 1)), dir = pinDir(num(at, 2));
    const length = mil(findChild(pin, 'length')?.children[0]?.value);
    const nameNode = findChild(pin, 'name');
    const numberNode = findChild(pin, 'number');
    const name = (nameNode && nameNode.children[0] ? nameNode.children[0].value : '~') || '~';
    const number = (numberNode && numberNode.children[0] ? numberNode.children[0].value : '~') || '~';
    const nameSize = effectsFontSizeMil(nameNode);
    const numSize = effectsFontSizeMil(numberNode);
    const hidden = pin.children.some(c => c.type === 'atom' && c.value === 'hide') ||
        (findChild(pin, 'hide')?.children[0]?.value === 'yes');
    if (hidden) shape = 'N' + shape;
    // X name number posx posy length dir snum snom unit convert etype [shape]
    let line = `X ${legacyName(name)} ${number} ${x} ${y} ${length} ${dir} ${numSize} ${nameSize} ${unit} ${convert} ${etype}`;
    if (shape) line += ` ${shape}`;
    return line;
}

function rectangleLine(node, unit, convert) {
    const s = findChild(node, 'start'), e = findChild(node, 'end');
    return `S ${mil(num(s, 0))} ${mil(num(s, 1))} ${mil(num(e, 0))} ${mil(num(e, 1))} ${unit} ${convert} ${strokeWidthMil(node)} ${fillChar(node)}`;
}
function circleLine(node, unit, convert) {
    const c = findChild(node, 'center'), r = findChild(node, 'radius');
    return `C ${mil(num(c, 0))} ${mil(num(c, 1))} ${mil(r?.children[0]?.value)} ${unit} ${convert} ${strokeWidthMil(node)} ${fillChar(node)}`;
}
function polylineLine(node, unit, convert) {
    const pts = findChild(node, 'pts');
    const xys = pts ? findChildren(pts, 'xy') : [];
    let line = `P ${xys.length} ${unit} ${convert} ${strokeWidthMil(node)}`;
    for (const xy of xys) line += ` ${mil(num(xy, 0))} ${mil(num(xy, 1))}`;
    line += ` ${fillChar(node)}`;
    return line;
}
function textLine(node, unit, convert) {
    const at = findChild(node, 'at');
    const angle = deci(num(at, 2));
    const x = mil(num(at, 0)), y = mil(num(at, 1));
    const text = node.children[0] ? node.children[0].value : '';
    const effects = findChild(node, 'effects');
    const font = effects ? findChild(effects, 'font') : null;
    const size = font ? mil(findChild(font, 'size')?.children[0]?.value) : 50;
    const italic = font && font.children.some(c => c.type === 'atom' && c.value === 'italic') ? 'Italic' : 'Normal';
    const bold = font && font.children.some(c => c.type === 'atom' && c.value === 'bold') ? '1' : '0';
    let hjust = 'C', vjust = 'C';
    const justify = effects ? findChild(effects, 'justify') : null;
    if (justify) for (const c of justify.children) {
        if (c.value === 'left') hjust = 'L'; else if (c.value === 'right') hjust = 'R';
        else if (c.value === 'top') vjust = 'T'; else if (c.value === 'bottom') vjust = 'B';
    }
    // T angle x y size hidden unit convert "text" Italic Bold HJustify VJustify
    return `T ${angle} ${x} ${y} ${size} 0 ${unit} ${convert} ${q(text)} ${italic} ${bold} ${hjust} ${vjust}`;
}

/** Legacy arc: A cx cy radius t1 t2 unit convert width fill startx starty endx endy (angles in decidegrees). */
function arcLine(node, unit, convert, warnings) {
    const s = findChild(node, 'start'), m = findChild(node, 'mid'), e = findChild(node, 'end');
    if (!s || !e) return null;
    const sx = parseFloat(num(s, 0)), sy = parseFloat(num(s, 1));
    const ex = parseFloat(num(e, 0)), ey = parseFloat(num(e, 1));
    const hasMid = m && isFinite(parseFloat(num(m, 0))) && isFinite(parseFloat(num(m, 1)));
    const mx = hasMid ? parseFloat(num(m, 0)) : (sx + ex) / 2;
    const my = hasMid ? parseFloat(num(m, 1)) : (sy + ey) / 2;
    let cx, cy;
    if (hasMid) {
        const d = 2 * (sx * (my - ey) + mx * (ey - sy) + ex * (sy - my));
        if (Math.abs(d) < 1e-9) { if (warnings) warnings.push('Dropped a degenerate symbol arc'); return null; }
        const s2 = sx * sx + sy * sy, m2 = mx * mx + my * my, e2 = ex * ex + ey * ey;
        cx = (s2 * (my - ey) + m2 * (ey - sy) + e2 * (sy - my)) / d;
        cy = (s2 * (ex - mx) + m2 * (sx - ex) + e2 * (mx - sx)) / d;
    } else {
        cx = (sx + ex) / 2; cy = (sy + ey) / 2;
    }
    const radius = Math.hypot(sx - cx, sy - cy);
    const t1 = Math.atan2(sy - cy, sx - cx) * 180 / Math.PI;
    let t2 = Math.atan2(ey - cy, ex - cx) * 180 / Math.PI;
    // Sweep start→end through the mid point (matches KiCad's own arc angles; the
    // legacy start/end angles are the actual endpoint angles, in decidegrees).
    // Using mid keeps arcs >180° correct instead of collapsing to the minor arc.
    if (hasMid) {
        const tm = Math.atan2(my - cy, mx - cx) * 180 / Math.PI;
        const n360 = (x) => ((x % 360) + 360) % 360;
        const dEnd = n360(t2 - t1), dMid = n360(tm - t1);
        t2 = t1 + (dMid <= dEnd ? dEnd : dEnd - 360);
    } else {
        let diff = t2 - t1;
        while (diff > 180) diff -= 360;
        while (diff <= -180) diff += 360;
        t2 = t1 + diff;
    }
    return `A ${Math.round(cx / 0.0254)} ${Math.round(cy / 0.0254)} ${Math.round(radius / 0.0254)} ${Math.round(t1 * 10)} ${Math.round(t2 * 10)} ${unit} ${convert} ${strokeWidthMil(node)} ${fillChar(node)} ${mil(sx)} ${mil(sy)} ${mil(ex)} ${mil(ey)}`;
}

// ---- per-symbol DEF -----------------------------------------------------------

/** Parse the trailing _<unit>_<convert> from a sub-symbol name. */
function parseUnitConvert(subName) {
    const m = /_(\d+)_(\d+)$/.exec(subName || '');
    return m ? { unit: parseInt(m[1]), convert: parseInt(m[2]) } : { unit: 0, convert: 1 };
}

function buildDef(symNode, aliasNames, warnings, cacheNames) {
    const name = outName(symNode.children[0] ? symNode.children[0].value : 'SYM', cacheNames);
    const refPrefix = getPropValue(symNode, 'Reference', 'U') || 'U';
    const isPower = !!findChild(symNode, 'power') ||
        symNode.children.some(c => c.type === 'list' && c.name === 'power');

    // pin_names offset → text offset; pin_numbers/pin_names hide → draw flags
    const pinNames = findChild(symNode, 'pin_names');
    const pinNumbers = findChild(symNode, 'pin_numbers');
    let textOffset = 40;
    if (pinNames) {
        const off = findChild(pinNames, 'offset');
        if (off && off.children[0]) textOffset = mil(off.children[0].value);
    }
    const hidePinNames = pinNames && (pinNames.children.some(c => c.type === 'atom' && c.value === 'hide') ||
        findChild(pinNames, 'hide')?.children[0]?.value === 'yes');
    const hidePinNumbers = pinNumbers && (pinNumbers.children.some(c => c.type === 'atom' && c.value === 'hide') ||
        findChild(pinNumbers, 'hide')?.children[0]?.value === 'yes');

    // Sub-symbols hold the graphics/pins; find max unit for the unit count.
    const subSyms = findChildren(symNode, 'symbol');
    let unitCount = 1;
    for (const sub of subSyms) {
        const { unit } = parseUnitConvert(sub.children[0]?.value);
        if (unit > unitCount) unitCount = unit;
    }

    const lines = [];
    lines.push(`#`);
    lines.push(`# ${name}`);
    lines.push(`#`);
    lines.push(`DEF ${name} ${legacyName(refPrefix)} 0 ${textOffset} ${hidePinNumbers ? 'N' : 'Y'} ${hidePinNames ? 'N' : 'Y'} ${unitCount} F ${isPower ? 'P' : 'N'}`);

    // Fields F0..F3 (standard) + custom F4+
    lines.push(fieldLine(0, refPrefix, getProp(symNode, 'Reference')));
    lines.push(fieldLine(1, getPropValue(symNode, 'Value', name), getProp(symNode, 'Value')));
    lines.push(fieldLine(2, getPropValue(symNode, 'Footprint', ''), getProp(symNode, 'Footprint')));
    lines.push(fieldLine(3, getPropValue(symNode, 'Datasheet', ''), getProp(symNode, 'Datasheet')));
    const SKIP_PROPS = new Set(['Reference', 'Value', 'Footprint', 'Datasheet',
        'ki_keywords', 'ki_description', 'ki_fp_filters', 'ki_locked']);
    let fIdx = 4;
    for (const p of findChildren(symNode, 'property')) {
        const pName = p.children[0] ? p.children[0].value : '';
        if (SKIP_PROPS.has(pName)) continue;
        const pVal = p.children[1] ? p.children[1].value : '';
        lines.push(fieldLine(fIdx, pVal, p, pName));
        fIdx++;
    }

    if (aliasNames.length > 0) {
        lines.push(`ALIAS ${aliasNames.join(' ')}`);
    }

    // $FPLIST from ki_fp_filters
    const fpFilters = getPropValue(symNode, 'ki_fp_filters', '').trim();
    if (fpFilters) {
        lines.push('$FPLIST');
        for (const f of fpFilters.split(/\s+/)) lines.push(` ${f}`);
        lines.push('$ENDFPLIST');
    }

    // DRAW section — emit graphics first, then pins (KiCad's own ordering).
    lines.push('DRAW');
    const graphics = [], pins = [];
    for (const sub of subSyms) {
        const { unit, convert } = parseUnitConvert(sub.children[0]?.value);
        for (const g of sub.children) {
            if (g.type !== 'list') continue;
            if (g.name === 'arc') { const l = arcLine(g, unit, convert, warnings); if (l) graphics.push(l); }
            else if (g.name === 'circle') graphics.push(circleLine(g, unit, convert));
            else if (g.name === 'rectangle') graphics.push(rectangleLine(g, unit, convert));
            else if (g.name === 'polyline') graphics.push(polylineLine(g, unit, convert));
            else if (g.name === 'text') graphics.push(textLine(g, unit, convert));
            else if (g.name === 'pin') pins.push(pinLine(g, unit, convert));
        }
    }
    lines.push(...graphics, ...pins);
    lines.push('ENDDRAW');
    lines.push('ENDDEF');
    return lines.join('\n');
}

// ---- .dcm records -------------------------------------------------------------

function dcmRecord(name, symNode, cacheNames) {
    const desc = getPropValue(symNode, 'ki_description', '');
    const keywords = getPropValue(symNode, 'ki_keywords', '');
    const datasheet = getPropValue(symNode, 'Datasheet', '');
    if (!desc && !keywords && !datasheet) return null;
    const out = [`$CMP ${outName(name, cacheNames)}`];
    if (desc) out.push(`D ${desc}`);
    if (keywords) out.push(`K ${keywords}`);
    if (datasheet) out.push(`F ${datasheet}`);
    out.push('$ENDCMP');
    return out.join('\n');
}

// ---- entry point --------------------------------------------------------------

/**
 * Convert a parsed .kicad_sym AST to legacy .lib + .dcm text.
 * @param {object} ast - parsed kicad_symbol_lib (or a synthetic one for a cache)
 * @param {string[]} warnings - collected warnings
 * @param {{ cacheNames?: boolean }} [opts] - when cacheNames is true, DEF/ALIAS/$CMP
 *        names use the full `libnick_Sym` form KiCad 5 uses for project-cache lookup.
 * @returns {{ lib: string, dcm: string }}
 */
export function writeLegacySymbolLib(ast, warnings = [], opts = {}) {
    const cacheNames = !!opts.cacheNames;
    const symbols = findChildren(ast, 'symbol');

    // Split into base symbols and derived (extends) symbols; map derived → base.
    const bases = [];
    const derivedByBase = new Map(); // baseLegacyName → [{name, node}]
    const allByLegacyName = new Map();
    for (const sym of symbols) {
        const ln = legacyName(sym.children[0]?.value);
        allByLegacyName.set(ln, sym);
    }
    for (const sym of symbols) {
        const ext = findChild(sym, 'extends');
        if (ext && ext.children[0]) {
            const baseLn = legacyName(ext.children[0].value);
            if (!derivedByBase.has(baseLn)) derivedByBase.set(baseLn, []);
            derivedByBase.get(baseLn).push(sym);
        } else {
            bases.push(sym);
        }
    }

    const libParts = ['EESchema-LIBRARY Version 2.4', '#encoding utf-8'];
    const dcmParts = ['EESchema-DOCLIB  Version 2.0', '#'];

    for (const base of bases) {
        const baseLn = legacyName(base.children[0]?.value);
        const derived = derivedByBase.get(baseLn) || [];
        const aliasNames = derived.map(d => outName(d.children[0]?.value, cacheNames));
        if (derived.some(d => findChildren(d, 'symbol').length > 0)) {
            warnings.push(`Symbol(s) extending "${baseLn}" carry their own graphics; only the base graphics are kept (legacy ALIAS limitation)`);
        }
        libParts.push(buildDef(base, aliasNames, warnings, cacheNames));

        const baseDcm = dcmRecord(base.children[0]?.value, base, cacheNames);
        if (baseDcm) { dcmParts.push(baseDcm); dcmParts.push('#'); }
        for (const d of derived) {
            const rec = dcmRecord(d.children[0]?.value, d, cacheNames);
            if (rec) { dcmParts.push(rec); dcmParts.push('#'); }
        }
    }

    // Any derived symbol whose base is missing → emit as a standalone graphic-less DEF.
    for (const [baseLn, derived] of derivedByBase) {
        if (allByLegacyName.has(baseLn) && bases.includes(allByLegacyName.get(baseLn))) continue;
        for (const d of derived) {
            warnings.push(`Derived symbol "${legacyName(d.children[0]?.value)}" extends missing base "${baseLn}"; emitted without graphics`);
            libParts.push(buildDef(d, [], warnings, cacheNames));
            const rec = dcmRecord(d.children[0]?.value, d, cacheNames);
            if (rec) { dcmParts.push(rec); dcmParts.push('#'); }
        }
    }

    libParts.push('#', '#End Library', '');
    dcmParts.push('#End Doc Library', '');

    return { lib: libParts.join('\n'), dcm: dcmParts.join('\n') };
}

/**
 * Merge several legacy .lib texts into one, de-duplicating symbols by DEF name
 * (first occurrence wins). Used to build a single project `<root>-cache.lib` from
 * the per-sheet caches of a hierarchical schematic — KiCad 5 loads only one
 * project cache, shared by every sheet.
 */
export function mergeCacheLibs(libTexts) {
    const seen = new Set();
    const blocks = [];
    // Optional `#\n# name\n#` comment header, then DEF <name> … ENDDEF.
    const re = /(?:#\r?\n#[^\n]*\r?\n#\r?\n)?DEF (\S+)[\s\S]*?\r?\nENDDEF/g;
    for (const text of libTexts) {
        if (!text) continue;
        let m;
        while ((m = re.exec(text))) {
            if (seen.has(m[1])) continue;
            seen.add(m[1]);
            blocks.push(m[0].trim());
        }
        re.lastIndex = 0;
    }
    return ['EESchema-LIBRARY Version 2.4', '#encoding utf-8', ...blocks, '#', '#End Library', ''].join('\n');
}
