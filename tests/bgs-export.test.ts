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
    const provider = new BgsProvider(data);
    const canonical = [1, 0.1, 0, 0, 0.3, 0.7, 0, 0, 0, 0, 1.4, 0, 0.2, -0.1, 0.4, 1];
    const stub = {
        animation: { provider, sourceRows: new Uint32Array([4, 3, 2, 1, 0]), readCanonical: (_: number, output: Float64Array) => output.set(canonical) },
        instances: { count: 3, sourceRow: new Uint32Array([0, 2, 4]), colorIndex: () => 0 },
        colorPalette: { getEntry: (_: number, output: ReturnType<typeof createGradeTerms>) => Object.assign(output, createGradeTerms()) }
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
    assert.ok(files.get('manifest.sha256').length > 0);
    const validation = JSON.parse(new TextDecoder().decode(files.get('validation.json')));
    assert.equal(validation.status, 'passed');
    assert.ok(validation.checks.max_covariance_error < 1e-5);
    await assert.rejects(createBgsExport(stub, true), /placement/);
    provider.dispose();
});
