/**
 * Test script: Validates the KiCad 10 → 9 PCB converter against real sample files.
 * Run with: node test/validate-pcb-k10.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src', 'lib');

// Dynamically import the modules
const { parseSExpr, serializeSExpr, findChild, getChildValue, findChildren } = await import(
    'file:///' + join(srcDir, 'sexpr-parser.js').replace(/\\/g, '/')
);
const { convertKicad, detectVersion } = await import(
    'file:///' + join(srcDir, 'converter.js').replace(/\\/g, '/')
);

const assetDir = join(__dirname, '..', '..', 'asset');

const tests = [
    { name: 'pic_programmer/pic_programmer.kicad_pcb', target: 'KICAD9' },
    { name: 'video/video.kicad_pcb', target: 'KICAD9' },
    { name: 'pic_programmer/pic_programmer.kicad_pcb', target: 'KICAD8' },
    { name: 'pic_programmer/pic_programmer.kicad_pcb', target: 'KICAD7' },
];

let passed = 0;
let failed = 0;

for (const test of tests) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`TEST: ${test.name} → ${test.target}`);
    console.log('='.repeat(70));

    const k10Path = join(assetDir, 'kicad10', test.name);

    let k10Content;
    try {
        k10Content = readFileSync(k10Path, 'utf-8');
    } catch (e) {
        console.log(`  SKIP: K10 file not found: ${k10Path}`);
        continue;
    }

    // Detect version
    const k10Info = detectVersion(k10Content);
    console.log(`  Input version: ${k10Info.version}, generator: ${k10Info.generatorVersion}, label: ${k10Info.label}`);

    // Convert
    try {
        const result = await convertKicad(k10Content, test.target);
        console.log(`\n  Conversion log (last 30 lines):`);
        const logLines = result.log.slice(-30);
        for (const line of logLines) {
            console.log(`    ${line}`);
        }

        if (result.warnings.length > 0) {
            console.log(`\n  Warnings:`);
            for (const w of result.warnings) {
                console.log(`    ⚠ ${w}`);
            }
        }

        // Verify output version
        const outputInfo = detectVersion(result.output);
        const expectedVersions = {
            'KICAD9': '20241229',
            'KICAD8': '20240108',
            'KICAD7': '20221018',
        };
        const expectedVersion = expectedVersions[test.target];
        const versionOk = outputInfo.version === expectedVersion;
        console.log(`\n  Output version: ${outputInfo.version} (expected ${expectedVersion}, ${versionOk ? '✓' : '✗'})`);
        console.log(`  Output generator: ${outputInfo.generatorVersion}`);

        // Verify output structure is valid S-expression
        let parseOk = false;
        try {
            const outputAst = parseSExpr(result.output);
            parseOk = outputAst && outputAst.name === 'kicad_pcb';
        } catch (e) {
            parseOk = false;
        }
        console.log(`  Valid S-expression output: ${parseOk ? '✓' : '✗'}`);

        // For K9 target: verify specific NP rules
        if (test.target === 'KICAD9') {
            const outputAst = parseSExpr(result.output);

            // Check: tenting should be compact format
            const setup = findChild(outputAst, 'setup');
            if (setup) {
                const tenting = findChild(setup, 'tenting');
                if (tenting) {
                    const hasNestedFront = findChild(tenting, 'front');
                    const tentingOk = !hasNestedFront; // Should NOT have nested (front yes)
                    console.log(`  NP2 tenting compact format: ${tentingOk ? '✓' : '✗'}`);
                }

                // Check: no covering/plugging/capping/filling in setup
                const noCovering = !findChild(setup, 'covering');
                const noPlugging = !findChild(setup, 'plugging');
                const noCapping = !findChild(setup, 'capping');
                const noFilling = !findChild(setup, 'filling');
                console.log(`  NP3 no via-hole attrs in setup: ${noCovering && noPlugging && noCapping && noFilling ? '✓' : '✗'}`);
            }

            // Check: net declarations exist after setup
            const netDecls = findChildren(outputAst, 'net');
            // Filter to only top-level net declarations (those with an integer ID child)
            const topNetDecls = netDecls.filter(n => {
                if (n.children.length >= 2) {
                    const first = n.children[0];
                    return first.type === 'atom' && !isNaN(Number(first.value));
                }
                return false;
            });
            console.log(`  NP5 net declarations found: ${topNetDecls.length} ${topNetDecls.length > 0 ? '✓' : '✗'}`);

            // Check: no string-based net references in segments
            let stringNetCount = 0;
            function checkStringNets(node) {
                if (!node || node.type !== 'list') return;
                if (node.name === 'segment' || node.name === 'via') {
                    const netNode = findChild(node, 'net');
                    if (netNode && netNode.children.length > 0) {
                        if (netNode.children[0].type === 'string') {
                            stringNetCount++;
                        }
                    }
                }
                for (const child of node.children) {
                    checkStringNets(child);
                }
            }
            checkStringNets(outputAst);
            console.log(`  NP6 no string net refs in segments/vias: ${stringNetCount === 0 ? '✓' : '✗'} (found ${stringNetCount})`);
        }

        // Save converted output for manual inspection
        const suffix = test.target.toLowerCase();
        const outPath = join(__dirname, `output_k10_${test.name.replace(/[\\\/]/g, '_')}_to_${suffix}`);
        writeFileSync(outPath, result.output);
        console.log(`  Output saved to: ${outPath}`);

        if (versionOk && parseOk) {
            console.log('\n  ✅ TEST PASSED');
            passed++;
        } else {
            console.log('\n  ❌ TEST FAILED');
            failed++;
        }
    } catch (err) {
        console.log(`  ❌ CONVERSION ERROR: ${err.message}`);
        console.log(err.stack);
        failed++;
    }
}

console.log(`\n${'='.repeat(70)}`);
console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
console.log('='.repeat(70));

process.exit(failed > 0 ? 1 : 0);
