import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { MemoryReadFileSystem } from '@playcanvas/splat-transform';

import { createBgsExport } from '../src/animation/bgs-export';
import { loadBgs } from '../src/animation/bgs-loader';
import { BgsProvider } from '../src/animation/bgs-provider';
import { createGradeTerms } from '../src/color-grade';
import type { Splat } from '../src/splat';

test('standard BGS export reorders stable IDs, preserves attributes and validates actual output', async () => {
    const fs = new MemoryReadFileSystem();
    for (const name of ['scene.json', 'gaussians.ply', 'animation.bin']) fs.set(name, await readFile(new URL(`fixtures/bgs/${name}`, import.meta.url)));
    const data = await loadBgs(fs, 'scene.json');
    // Add typed attributes the editor does not interpret, including values that
    // would lose precision if routed through a float32 Gaussian resource.
    const g = data.gaussians;
    const header = new TextEncoder().encode(new TextDecoder().decode(g.bytes.subarray(0, g.headerBytes))
    .replace('end_header', 'property double research_score\nproperty uchar category\nend_header'));
    const augmented = new Uint8Array(header.length + (g.stride + 9) * g.count);
    augmented.set(header);
    const extra = new DataView(augmented.buffer);
    for (let row = 0; row < g.count; row++) {
        const start = header.length + row * (g.stride + 9);
        augmented.set(g.bytes.subarray(g.headerBytes + row * g.stride, g.headerBytes + (row + 1) * g.stride), start);
        extra.setFloat64(start + g.stride, Math.PI + row / 10, true);
        extra.setUint8(start + g.stride + 8, 180 + row);
    }
    fs.set('gaussians.ply', augmented);
    const enriched = await loadBgs(fs, 'scene.json');
    const provider = new BgsProvider(enriched);
    const canonical = [1, 0.1, 0, 0, 0.3, 0.7, 0, 0, 0, 0, 1.4, 0, 0.2, -0.1, 0.4, 1];
    const stub = {
        animation: { provider, sourceRows: new Uint32Array([4, 3, 2, 1, 0]), readCanonical: (_: number, output: Float64Array) => output.set(canonical) },
        instances: { count: 3, sourceRow: new Uint32Array([0, 2, 4]), colorIndex: () => 1 },
        colorPalette: { getEntry: (_: number, output: ReturnType<typeof createGradeTerms>) => {
            Object.assign(output, createGradeTerms());
            output.m[0] = 0.8; output.m[4] = 1.2; output.m[8] = 0.7;
            output.offset = { r: 0.1, g: -0.05, b: 0.03 };
            output.transparency = 0.6;
        } }
    } as unknown as Splat;
    const files = await createBgsExport(stub);
    const outputFs = new MemoryReadFileSystem();
    files.forEach((bytes, name) => outputFs.set(name, bytes));
    const output = await loadBgs(outputFs, 'scene.json');
    assert.notEqual(output.scene.asset.id, data.scene.asset.id);
    assert.deepEqual(Array.from(output.gaussians.sourceIds), [data.gaussians.sourceIds[4], data.gaussians.sourceIds[2], data.gaussians.sourceIds[0]]);
    assert.deepEqual(output.scene.nodes, data.scene.nodes);
    assert.deepEqual(output.scene.animation.clips, data.scene.animation.clips);
    assert.deepEqual(output.animationBytes, data.animationBytes);
    const result = new DataView(output.gaussians.bytes.buffer, output.gaussians.bytes.byteOffset, output.gaussians.bytes.byteLength);
    const score = output.gaussians.properties.find(property => property.name === 'research_score');
    for (const [i, row] of [4, 2, 0].entries()) {
        const start = output.gaussians.headerBytes + i * output.gaussians.stride;
        assert.equal(result.getFloat64(start + score.offset, true), Math.PI + row / 10);
        assert.equal(result.getUint8(start + score.offset + 8), 180 + row);
    }
    assert.ok(files.get('manifest.sha256').length > 0);
    const validation = JSON.parse(new TextDecoder().decode(files.get('validation.json')));
    assert.equal(validation.status, 'passed');
    assert.ok(validation.checks.max_covariance_error < 1e-5);
    await assert.rejects(createBgsExport(stub, true), /placement/);
    provider.dispose();
});
