/**
 * S-expression parser for KiCad schematic files.
 * Parses KiCad .kicad_sch files into an AST (Abstract Syntax Tree).
 * 
 * The AST node structure:
 * {
 *   type: 'list' | 'atom',
 *   name: string,        // first token in a list (e.g. 'kicad_sch', 'wire', 'symbol')
 *   children: Node[],    // child nodes (for 'list' type)
 *   value: string,       // raw value (for 'atom' type)
 * }
 */

class SExprTokenizer {
    constructor(input) {
        this.input = input;
        this.pos = 0;
        this.length = input.length;
    }

    peek() {
        this.skipWhitespaceAndComments();
        if (this.pos >= this.length) return null;
        return this.input[this.pos];
    }

    skipWhitespaceAndComments() {
        while (this.pos < this.length) {
            const ch = this.input[this.pos];
            // Skip whitespace
            if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
                this.pos++;
                continue;
            }
            // Skip line comments (;; ...)
            if (ch === ';' && this.pos + 1 < this.length && this.input[this.pos + 1] === ';') {
                while (this.pos < this.length && this.input[this.pos] !== '\n') {
                    this.pos++;
                }
                continue;
            }
            break;
        }
    }

    nextToken() {
        this.skipWhitespaceAndComments();
        if (this.pos >= this.length) return null;

        const ch = this.input[this.pos];

        if (ch === '(') {
            this.pos++;
            return { type: 'open' };
        }

        if (ch === ')') {
            this.pos++;
            return { type: 'close' };
        }

        // Quoted string
        if (ch === '"') {
            return this.readQuotedString();
        }

        // Unquoted atom (symbol, number, keyword)
        return this.readAtom();
    }

    readQuotedString() {
        this.pos++; // skip opening quote
        let result = '';
        while (this.pos < this.length) {
            const ch = this.input[this.pos];
            if (ch === '\\') {
                this.pos++;
                if (this.pos < this.length) {
                    const escaped = this.input[this.pos];
                    switch (escaped) {
                        case 'n': result += '\n'; break;
                        case 'r': result += '\r'; break;
                        case 't': result += '\t'; break;
                        case '\\': result += '\\'; break;
                        case '"': result += '"'; break;
                        default: result += '\\' + escaped; break;
                    }
                    this.pos++;
                }
            } else if (ch === '"') {
                this.pos++; // skip closing quote
                return { type: 'string', value: result };
            } else {
                result += ch;
                this.pos++;
            }
        }
        return { type: 'string', value: result };
    }

    readAtom() {
        let result = '';
        while (this.pos < this.length) {
            const ch = this.input[this.pos];
            if (ch === '(' || ch === ')' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '"') {
                break;
            }
            result += ch;
            this.pos++;
        }
        return { type: 'atom', value: result };
    }
}

/**
 * Parse an S-expression string into an AST.
 * @param {string} input - the content of a .kicad_sch file
 * @returns {object} - root AST node
 */
export function parseSExpr(input) {
    const tokenizer = new SExprTokenizer(input);
    const result = parseNode(tokenizer);
    return result;
}

function parseNode(tokenizer) {
    const token = tokenizer.nextToken();
    if (!token) return null;

    if (token.type === 'open') {
        // Parse a list: (name child1 child2 ...)
        const children = [];
        let name = null;

        while (true) {
            const peek = tokenizer.peek();
            if (peek === null || peek === ')') {
                tokenizer.nextToken(); // consume ')'
                break;
            }

            const child = parseNode(tokenizer);
            if (child) {
                // The first atom/string in a list is treated as the list's name
                if (name === null && (child.type === 'atom' || child.type === 'string')) {
                    name = child.value;
                } else {
                    children.push(child);
                }
            }
        }

        return {
            type: 'list',
            name: name || '',
            children: children,
        };
    }

    if (token.type === 'atom') {
        return { type: 'atom', value: token.value };
    }

    if (token.type === 'string') {
        return { type: 'string', value: token.value };
    }

    return null;
}

/**
 * Serialize an AST node back into S-expression text.
 * @param {object} node - AST node
 * @param {number} indent - current indent level
 * @returns {string}
 */
export function serializeSExpr(node, indent = 0) {
    if (!node) return '';

    if (node.type === 'atom') {
        return node.value;
    }

    if (node.type === 'string') {
        return `"${escapeString(node.value)}"`;
    }

    if (node.type === 'list') {
        return serializeList(node, indent);
    }

    return '';
}

function escapeString(str) {
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}

/**
 * Determines if a list node should be serialized on a single line.
 */
function isSimpleList(node) {
    if (node.children.length === 0) return true;

    // Simple lists: all children are atoms/strings (no nested lists)
    const allAtomic = node.children.every(c => c.type === 'atom' || c.type === 'string');
    if (allAtomic && node.children.length <= 6) return true;

    // Special cases for KiCad formatting
    const simpleLists = [
        'version', 'generator', 'generator_version', 'uuid', 'paper',
        'at', 'size', 'xy', 'center', 'radius', 'width', 'type',
        'diameter', 'color', 'offset', 'length', 'number', 'name',
        'justify', 'hide', 'page', 'comment', 'path', 'reference',
        'unit', 'in_bom', 'on_board', 'exclude_from_sim', 'dnp',
        'exclude_from_board', 'fields_autoplaced', 'embedded_fonts',
        'mirror',
    ];

    if (simpleLists.includes(node.name)) return true;

    // 'pts' with a few xy children can stay inline
    if (node.name === 'pts' && node.children.length <= 4 &&
        node.children.every(c => c.type === 'list' && c.name === 'xy')) {
        return true;
    }

    return false;
}

function serializeList(node, indent) {
    const tabs = '\t'.repeat(indent);
    const innerTabs = '\t'.repeat(indent + 1);

    // Build the opening: (name args...)
    let opening = `(${node.name}`;

    if (isSimpleList(node)) {
        // Single-line format
        const parts = node.children.map(c => serializeSExpr(c, indent + 1));
        if (parts.length > 0) {
            opening += ' ' + parts.join(' ');
        }
        opening += ')';
        return opening;
    }

    // Multi-line format
    let result = opening;

    // Separate inline args (atoms/strings at the beginning) from block children (lists)
    const inlineArgs = [];
    let blockStartIdx = 0;

    for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child.type === 'atom' || child.type === 'string') {
            inlineArgs.push(child);
            blockStartIdx = i + 1;
        } else {
            break;
        }
    }

    // Add inline args to the opening line
    if (inlineArgs.length > 0) {
        result += ' ' + inlineArgs.map(c => serializeSExpr(c, indent + 1)).join(' ');
    }

    result += '\n';

    // Add block children on separate lines
    for (let i = blockStartIdx; i < node.children.length; i++) {
        const child = node.children[i];
        result += innerTabs + serializeSExpr(child, indent + 1) + '\n';
    }

    result += tabs + ')';
    return result;
}

/**
 * Helper to find a direct child list node by name.
 */
export function findChild(node, name) {
    if (!node || node.type !== 'list') return null;
    return node.children.find(c => c.type === 'list' && c.name === name) || null;
}

/**
 * Helper to find ALL direct child list nodes by name.
 */
export function findChildren(node, name) {
    if (!node || node.type !== 'list') return [];
    return node.children.filter(c => c.type === 'list' && c.name === name);
}

/**
 * Helper to remove a direct child list node by name.
 * Returns true if removed.
 */
export function removeChild(node, name) {
    if (!node || node.type !== 'list') return false;
    const idx = node.children.findIndex(c => c.type === 'list' && c.name === name);
    if (idx >= 0) {
        node.children.splice(idx, 1);
        return true;
    }
    return false;
}

/**
 * Helper to remove ALL direct child list nodes by name.
 * Returns count of removed nodes.
 */
export function removeAllChildren(node, name) {
    if (!node || node.type !== 'list') return 0;
    const before = node.children.length;
    node.children = node.children.filter(c => !(c.type === 'list' && c.name === name));
    return before - node.children.length;
}

/**
 * Get the first atom/string value of a child list node.
 * e.g. for (version 20250114), getChildValue(root, 'version') => '20250114'
 */
export function getChildValue(node, name) {
    const child = findChild(node, name);
    if (!child || child.children.length === 0) return null;
    const first = child.children[0];
    return first ? first.value : null;
}

/**
 * Set the first atom/string value of a child list node.
 */
export function setChildValue(node, name, value) {
    const child = findChild(node, name);
    if (!child) return false;
    if (child.children.length === 0) {
        child.children.push({ type: 'atom', value: String(value) });
    } else {
        child.children[0].value = String(value);
    }
    return true;
}
