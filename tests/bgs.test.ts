import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import { bgsFileAliases, isBgsSceneFilename } from '../src/animation/bgs-import';
import { parseGaussians, safeAssetPath, validateScene } from '../src/animation/bgs-loader';
import { BgsProvider } from '../src/animation/bgs-provider';
import type { BgsData, BgsScene } from '../src/animation/bgs-types';
import { blend, dot, fromDualQuaternion, gaussianCovariance, identityPose, poseMatrix, toDualQuaternion, transformCovariance } from '../src/animation/math';

const fixture = new URL('./fixtures/bgs/', import.meta.url);
const oracle = createRequire(import.meta.url)('./fixtures/bgs/reference-player.cjs');
const near = (a: ArrayLike<number>, b: ArrayLike<number>, tolerance = 1e-8): void => {
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < tolerance, `component ${i}: ${a[i]} != ${b[i]}`);
};
const load = (): BgsData => {
    const value = JSON.parse(readFileSync(new URL('scene.json', fixture), 'utf8')) as BgsScene;
    const animationBytes = new Uint8Array(readFileSync(new URL('animation.bin', fixture)));
    const validated = validateScene(value, animationBytes);
    return { ...validated, animationBytes, gaussians: parseGaussians(new Uint8Array(readFileSync(new URL('gaussians.ply', fixture))), value) };
};

test('bind identity, hard binding and sampled hierarchy match independent CPU oracle', async () => {
    const data = load();
    const provider = new BgsProvider(data);
    for (const time of [0, 0.01, 0.025, 0.05, 0.067, 5]) {
        const frame = await provider.prepare(data.scene.animation.clips[0].id, time, 1);
        const locals = oracle.poseAt(data.scene, data.scene.animation.clips[0], data.animationBytes.buffer, time, false);
        const deltas = oracle.deltasFromLocals(data.scene, locals);
        for (let row = 0; row < data.gaussians.count; row++) {
            const offset = row * 4;
            const influences = Array.from({ length: 4 }, (_, k) => ({ node: data.gaussians.bindNodes[offset + k], weight: data.gaussians.bindWeights[offset + k] }));
            const expected = oracle.blendDualQuaternions(influences, deltas);
            const actual = frame.dualQuaternion(row);
            near(actual.real, expected.real);
            near(actual.dual, expected.dual);
            const output = { position: new Float64Array(3), covariance: new Float64Array(9) };
            frame.readGaussian(row, output);
            near(output.position, oracle.dqTransformPoint(expected, Array.from(data.gaussians.positions.subarray(row * 3, row * 3 + 3))));
        }
    }
    const bind = await provider.prepare('__bind__', 0, 2);
    near(bind.dualQuaternion(3).real, [0, 0, 0, 1]);
    near(bind.dualQuaternion(3).dual, [0, 0, 0, 0]);
});

test('soft binding flips both quaternion halves, uses deterministic pivot and fallback', () => {
    const first = toDualQuaternion({ translation: [1, 2, 3], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] });
    const second = { real: first.real.map(x => -x), dual: first.dual.map(x => -x) };
    const result = blend([1, 0, 0, 0], [0.5, 0.5, 0, 0], [first, second]);
    near(fromDualQuaternion(result).translation, [1, 2, 3]);
    assert.ok(Math.abs(dot(result.real, result.dual)) < 1e-10);
    assert.equal(result.pivot, 0);
    const fallback = blend([1, 0, 0, 0], [0.5, 0.5, 0, 0], [first, second], 2);
    assert.equal(fallback.fallback, true);
    near(fallback.real, first.real);
});

test('anisotropic covariance transforms with uniform units and rotation', () => {
    const covariance = gaussianCovariance([0, 0, 0, 1], [Math.log(1), Math.log(2), Math.log(3)]);
    const matrix = poseMatrix({ translation: [5, 6, 7], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] });
    for (let i = 0; i < 12; i++) if (i % 4 !== 3) matrix[i] *= 2;
    const output = new Float64Array(9);
    transformCovariance(matrix, covariance, output);
    near(output, [16, 0, 0, 0, 4, 0, 0, 0, 36]);
    near(poseMatrix(identityPose()), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
});

test('step clips hold samples and binary endpoints clamp', async () => {
    const data = load();
    const clip = data.scene.animation.clips[0];
    clip.interpolation = 'step';
    const provider = new BgsProvider(data);
    const a = await provider.prepare(clip.id, 0, 0);
    const b = await provider.prepare(clip.id, clip.times_seconds[1] / 2, 1);
    near(a.dualQuaternion(2).real, b.dualQuaternion(2).real);
    const last = await provider.prepare(clip.id, 100, 2);
    assert.equal(last.time, clip.duration_seconds);
});

test('rejects unsafe paths, malformed clips, animated root and incorrect inverse binds', () => {
    for (const uri of ['../escape.ply', '/absolute.ply', 'https://host/a', '%2e%2e/a', 'a\\b', 'a//b', 'a#b']) {
        assert.throws(() => safeAssetPath('scene.json', uri));
    }
    assert.equal(safeAssetPath('folder/scene.json', 'mesh/gaussians.ply'), 'folder/mesh/gaussians.ply');
    const data = load();
    const bad = structuredClone(data.scene);
    bad.nodes[2].inverse_bind_matrix[12] += 1;
    assert.throws(() => validateScene(bad, data.animationBytes), /Inverse bind/);
    const short = data.animationBytes.subarray(0, 12);
    assert.throws(() => validateScene(data.scene, short), /binary range/);
    const root = data.animationBytes.slice();
    new DataView(root.buffer).setFloat32(0, 1, true);
    assert.throws(() => validateScene(data.scene, root), /root/);
    const overlap = structuredClone(data.scene);
    overlap.animation.clips.push({ ...overlap.animation.clips[0], id: 'other' });
    assert.throws(() => validateScene(overlap, data.animationBytes), /Overlapping/);
});

test('preserves raw PLY and rejects corrupt weights and duplicate source IDs', () => {
    const data = load();
    const original = data.gaussians.bytes;
    near(data.gaussians.bytes, original);
    const weights = original.slice();
    const property = data.gaussians.properties.find(p => p.name === 'bind_weight_0')!;
    new DataView(weights.buffer).setFloat32(data.gaussians.headerBytes + property.offset, 0, true);
    assert.throws(() => parseGaussians(weights, data.scene), /sum to one/);
    const ids = original.slice();
    const id = data.gaussians.properties.find(p => p.name === 'source_gaussian_id')!;
    const view = new DataView(ids.buffer);
    view.setUint32(data.gaussians.headerBytes + data.gaussians.stride + id.offset, data.gaussians.sourceIds[0], true);
    assert.throws(() => parseGaussians(ids, data.scene), /Duplicate Gaussian ID/);
});

test('cancelled and disposed providers reject evaluation', async () => {
    const provider = new BgsProvider(load());
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(provider.prepare('unknown', 0, 1, controller.signal));
    provider.dispose();
    await assert.rejects(provider.prepare('__bind__', 0, 2), /disposed/);
});

test('degree-two SH rebase agrees on independent directions and animation leaves scene-frame coefficients fixed', async () => {
    const { Mat3, Quat } = await import('playcanvas');
    const { SHRotation } = await import('../src/sh-utils');
    const q = new Quat().setFromEulerAngles(30, 50, -20);
    const matrix = new Mat3().setFromQuat(q);
    const rotation = new SHRotation(matrix);
    const coefficients = [0.1, -0.2, 0.3, -0.1, 0.4, 0.2, -0.3, 0.15];
    const rebased = coefficients.slice();
    rotation.apply(rebased, coefficients);
    for (let i = 1; i <= 32; i++) {
        const direction = [Math.sin(i * 1.7), Math.cos(i * 2.3), Math.sin(i * 0.9)];
        const sourceDirection = oracle.qRotate([-q.x, -q.y, -q.z, q.w], direction);
        near(oracle.evalSh2([0, 0, 0], [rebased, rebased, rebased], direction),
            oracle.evalSh2([0, 0, 0], [coefficients, coefficients, coefficients], sourceDirection), 1e-6);
    }
    const data = load();
    const bytes = data.gaussians.bytes.slice();
    await new BgsProvider(data).prepare(data.scene.animation.clips[0].id, 0.02, 1);
    assert.deepEqual(data.gaussians.bytes, bytes);
});

test('directory/URL filesystem loader reads only declared relative assets', async () => {
    const { MemoryReadFileSystem } = await import('@playcanvas/splat-transform');
    const { loadBgs } = await import('../src/animation/bgs-loader');
    const fs = new MemoryReadFileSystem();
    for (const name of ['scene.json', 'gaussians.ply', 'animation.bin']) fs.set(`assets/${name}`, new Uint8Array(readFileSync(new URL(name, fixture))));
    const data = await loadBgs(fs, 'assets/scene.json');
    assert.equal(data.gaussians.count, 5);
    assert.equal(data.scene.animation.clips.length, 1);
    const missing = new MemoryReadFileSystem();
    missing.set('scene.json', new Uint8Array(readFileSync(new URL('scene.json', fixture))));
    await assert.rejects(loadBgs(missing, 'scene.json'));
});

test('scene.json next to its assets is recognized with folder prefixes and backslashes', async () => {
    const { MemoryReadFileSystem } = await import('@playcanvas/splat-transform');
    const { loadBgs } = await import('../src/animation/bgs-loader');
    assert.equal(isBgsSceneFilename('scene.json'), true);
    assert.equal(isBgsSceneFilename('pack/scene.json'), true);
    assert.equal(isBgsSceneFilename('pack\\scene.json'), true);
    assert.equal(isBgsSceneFilename('cameras.json'), false);
    const fs = new MemoryReadFileSystem();
    for (const name of ['scene.json', 'gaussians.ply', 'animation.bin']) {
        const bytes = new Uint8Array(readFileSync(new URL(name, fixture)));
        for (const alias of bgsFileAliases('pack/scene.json', `pack\\${name}`)) fs.set(alias, bytes);
    }
    const data = await loadBgs(fs, 'pack/scene.json');
    assert.equal(data.gaussians.count, 5);
    assert.equal(data.scene.animation.clips.length, 1);
});
