/**
 * Test script: Validates the KiCad 9 → 8 converter against real sample files.
 * Run with: node --experimental-vm-modules test/validate.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src', 'lib');

// Dynamically import the modules
const { parseSExpr, serializeSExpr, findChild, getChildValue } = await import(
    'file:///' + join(srcDir, 'sexpr-parser.js').replace(/\\/g, '/')
);
const { convertKicad9to8, detectVersion } = await import(
    'file:///' + join(srcDir, 'converter.js').replace(/\\/g, '/')
);

const assetDir = join(__dirname, '..', '..', 'asset');

const tests = [
    { name: 'video/video.kicad_sch', expectHide: true, expectSheetAttrs: false, expectSheetPin: true },
    { name: 'video/bus_pci.kicad_sch', expectHide: true, expectSheetAttrs: false, expectSheetPin: false },
    { name: 'video/graphic.kicad_sch', expectHide: true, expectSheetAttrs: false, expectSheetPin: false },
    { name: 'flat_hierarchy/flat_hierarchy.kicad_sch', expectHide: false, expectSheetAttrs: true, expectSheetPin: false },
];

let passed = 0;
let failed = 0;

for (const test of tests) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TEST: ${test.name}`);
    console.log('='.repeat(60));

    const k9Path = join(assetDir, 'kicad9', test.name);
    const k8Path = join(assetDir, 'kicad8', test.name);

    let k9Content, k8Content;
    try {
        k9Content = readFileSync(k9Path, 'utf-8');
    } catch (e) {
        console.log(`  SKIP: K9 file not found: ${k9Path}`);
        continue;
    }
    try {
        k8Content = readFileSync(k8Path, 'utf-8');
    } catch (e) {
        console.log(`  SKIP: K8 file not found (for comparison): ${k8Path}`);
        k8Content = null;
    }

    // Detect version
    const k9Info = detectVersion(k9Content);
    console.log(`  K9 version: ${k9Info.version}, generator: ${k9Info.generatorVersion}, isK9: ${k9Info.isKicad9}`);

    if (k8Content) {
        const k8Info = detectVersion(k8Content);
        console.log(`  K8 version: ${k8Info.version}, generator: ${k8Info.generatorVersion}, isK9: ${k8Info.isKicad9}`);
    }

    // Convert
    try {
        const result = convertKicad9to8(k9Content);
        console.log(`\n  Conversion log:`);
        for (const line of result.log) {
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
        const versionOk = outputInfo.version === '20231120';
        const generatorOk = outputInfo.generatorVersion === '8.0';
        console.log(`\n  Output version: ${outputInfo.version} (${versionOk ? '✓' : '✗'})`);
        console.log(`  Output generator: ${outputInfo.generatorVersion} (${generatorOk ? '✓' : '✗'})`);

        // Verify no (embedded_fonts) in output
        const hasEmbeddedFonts = result.output.includes('embedded_fonts');
        console.log(`  No embedded_fonts: ${!hasEmbeddedFonts ? '✓' : '✗'}`);

        // Verify no KiCad 9 style hide in output (should not have "(hide yes)" except in effects)
        // Actually in KiCad 8, (hide yes) IS used inside (effects) blocks, so we need to check pin_names and pin specifically

        // Verify output structure is valid S-expression
        let parseOk = false;
        try {
            const outputAst = parseSExpr(result.output);
            parseOk = outputAst && outputAst.name === 'kicad_sch';
        } catch (e) {
            parseOk = false;
        }
        console.log(`  Valid S-expression output: ${parseOk ? '✓' : '✗'}`);

        // Save converted output for manual inspection
        const outPath = join(__dirname, `output_${test.name.replace(/\//g, '_')}`);
        writeFileSync(outPath, result.output);
        console.log(`  Output saved to: ${outPath}`);

        if (versionOk && generatorOk && !hasEmbeddedFonts && parseOk) {
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

console.log(`\n${'='.repeat(60)}`);
console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
console.log('='.repeat(60));

process.exit(failed > 0 ? 1 : 0);
