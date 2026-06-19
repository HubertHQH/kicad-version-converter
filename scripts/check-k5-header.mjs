// Strict KiCad-5 PCB header validator.
//
// Emulates the part of KiCad 5.1's PCB_PARSER::parseHeader() that rejected our
// earlier output: after (version N) it does NeedLEFT() then NeedSYMBOL() x3 then
// NeedRIGHT() to skip the host line. A two-token (generator pcbnew) fails the
// third NeedSYMBOL() with: Expecting "'symbol'".
//
// Usage: node scripts/check-k5-header.mjs <file1.kicad_pcb> [file2 ...]
import { readFileSync } from 'node:fs';

// Minimal DSNLEXER-style tokenizer: a token is '(' , ')', a quoted string, or a
// bare symbol/number. In KiCad, both bare symbols and quoted strings satisfy
// NeedSYMBOL() (IsSymbol() accepts DSN_SYMBOL and DSN_STRING).
function* tokenize(s) {
    let i = 0, line = 1, col = 0;
    const adv = () => { if (s[i] === '\n') { line++; col = 0; } else { col++; } i++; };
    while (i < s.length) {
        const ch = s[i];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { adv(); continue; }
        const tline = line, tcol = col;
        if (ch === '(') { adv(); yield { kind: 'L', line: tline, col: tcol }; continue; }
        if (ch === ')') { adv(); yield { kind: 'R', line: tline, col: tcol }; continue; }
        if (ch === '"') {
            adv();
            while (i < s.length && s[i] !== '"') { if (s[i] === '\\') adv(); adv(); }
            adv(); // closing quote
            yield { kind: 'SYMBOL', strType: 'string', line: tline, col: tcol };
            continue;
        }
        while (i < s.length && !' \t\n\r()"'.includes(s[i])) adv();
        yield { kind: 'SYMBOL', strType: 'atom', line: tline, col: tcol };
    }
}

function checkHeader(path) {
    const text = readFileSync(path, 'utf8');
    const toks = [...tokenize(text)];
    let p = 0;
    const need = (kind, what) => {
        const t = toks[p++];
        if (!t || t.kind !== kind) {
            const at = t ? `line ${t.line}, offset ${t.col}` : 'EOF';
            throw new Error(`Expecting '${what}' at ${at}`);
        }
        return t;
    };
    need('L', '(');
    const root = need('SYMBOL', 'symbol'); // kicad_pcb
    need('L', '(');
    const verKw = need('SYMBOL', 'symbol'); // version
    need('SYMBOL', 'symbol');               // version number
    need('R', ')');
    // The host line — exactly what KiCad 5 skips with NeedSYMBOL x3.
    need('L', '(');
    need('SYMBOL', 'symbol'); // host
    need('SYMBOL', 'symbol'); // pcbnew
    need('SYMBOL', 'symbol'); // build version  <-- the previously-missing token
    need('R', ')');
    return true;
}

let failures = 0;
for (const path of process.argv.slice(2)) {
    try {
        checkHeader(path);
        console.log(`   ✓ ${path}  — KiCad 5 header OK`);
    } catch (e) {
        failures++;
        console.log(`   ✗ ${path}  — ${e.message}`);
    }
}
console.log(failures === 0 ? '\n✅ ALL HEADERS VALID FOR KICAD 5' : `\n❌ ${failures} FILE(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
