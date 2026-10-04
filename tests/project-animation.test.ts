import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryReadFileSystem } from '@playcanvas/splat-transform';

import { encodeCanonicalEdits, readCanonicalEdits } from '../src/animation/project-animation';
import type { Splat } from '../src/splat';

test('canonical project sidecar preserves float64 and rejects malformed affine records', async () => {
    const matrix = new Float64Array([1, 0, 0, 0, 0.2, 2, 0, 0, 0, 0, 0.5, 0, Math.PI, 0.1, 0, 1]);
    const stub = { instances: { count: 1, canonicalEdits: matrix } } as unknown as Splat;
    const bytes = encodeCanonicalEdits(stub);
    const fs = new MemoryReadFileSystem();
    fs.set('canonical.bin', bytes);
    const result = await readCanonicalEdits(fs, 'canonical.bin', 1, 4);
    assert.deepEqual(result.subarray(0, 16), matrix);
    assert.equal(result.length, 64);
    await assert.rejects(readCanonicalEdits(fs, 'canonical.bin', 2, 4), /length/);
    const corrupt = bytes.slice();
    new DataView(corrupt.buffer).setFloat64(3 * 8, 0.1, true);
    fs.set('bad.bin', corrupt);
    await assert.rejects(readCanonicalEdits(fs, 'bad.bin', 1, 1), /affine/);
});
