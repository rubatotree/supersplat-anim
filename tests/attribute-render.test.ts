import assert from 'node:assert/strict';
import test from 'node:test';

import { createChunkDataPool } from '@playcanvas/splat-transform';

import { readAttributeColumns } from '../src/attribute-data';
import { AttributeSettingsOp, defaultAttributeSettings, normalizeAttributeSettings, rgbPropertyGroups } from '../src/attribute-render';
import type { EditorSplatResource } from '../src/editor-splat-resource';
import type { Splat } from '../src/splat';

test('attribute settings restore safely and keep independent RGB channels', () => {
    assert.deepEqual(normalizeAttributeSettings(), defaultAttributeSettings());
    const settings = normalizeAttributeSettings({ mode: 'pseudo-normal', channels: ['a', 'b', 'c'], min: 5, max: -2 });
    assert.equal(settings.mode, 'pseudo-normal');
    assert.equal(settings.min, 0);
    assert.equal(settings.max, 1);
    const copy = normalizeAttributeSettings(JSON.parse(JSON.stringify(settings)));
    copy.channels[0] = 'other';
    assert.equal(settings.channels[0], 'a');
    assert.equal(normalizeAttributeSettings({ mode: 'invalid' as any, min: NaN }).mode, 'color');
});

test('attribute edits undo and redo complete per-layer settings', () => {
    const notifications: unknown[] = [];
    const splat = {
        attributeSettings: defaultAttributeSettings(), changedCounter: 0,
        scene: { forceRender: false, events: { fire: (...args: unknown[]) => notifications.push(args) } }
    } as unknown as Splat;
    const op = new AttributeSettingsOp(splat, normalizeAttributeSettings({ mode: 'rgb', channels: ['r','g','b'] }));
    op.do(); assert.equal(splat.attributeSettings.mode, 'rgb');
    op.undo(); assert.equal(splat.attributeSettings.mode, 'color');
    op.do(); assert.deepEqual(splat.attributeSettings.channels, ['r','g','b']);
    assert.equal(notifications.length, 3);
    assert.equal(splat.scene.forceRender, true);
});

test('RGB discovery accepts complete groups without swallowing scalar columns', () => {
    const groups = rgbPropertyGroups(['flow_x', 'flow_y', 'flow_z', 'tint_r', 'tint_g', 'tint_b', 'v_0', 'v_1', 'v_2', 'partial_x', 'heat']);
    assert.deepEqual(groups.map(g => g.name), ['flow', 'tint', 'v']);
    assert.deepEqual(groups[0].channels, ['flow_x', 'flow_y', 'flow_z']);
});

test('lazy attribute reads address canonical fields, extras and current source row order', async () => {
    const layouts = {
        position: { stride: 12, fields: { position: { byteOffset: 0, components: 3, type: 'float32' as const } } },
        other: { stride: 8, fields: { heat: { byteOffset: 0, components: 1, type: 'float32' as const }, id: { byteOffset: 4, components: 1, type: 'uint32' as const } } }
    };
    const pool = createChunkDataPool({ chunkSize: 1, maxPooledBytes: 64 });
    const resource = {
        numRows: 2, sourcePool: pool,
        source: {
            meta: { layouts, chunkSize: 1, numChunks: [2] },
            read: async ({ chunkIndex, position, other }: any) => {
                const row = 1 - chunkIndex;
                if (position) new Float32Array(position.data).set([row, row + 2, row + 3]);
                if (other) {
                    const view = new DataView(other.data);
                    view.setFloat32(0, row ? -7 : NaN, true);
                    view.setUint32(4, row + 10, true);
                }
            }
        }
    } as unknown as EditorSplatResource;
    try {
        const values = await readAttributeColumns(resource, ['y', 'heat', 'id']);
        assert.deepEqual(Array.from(values.subarray(0, 4)), [3, -7, 11, 0]);
        assert.equal(values[4], 2);
        assert.ok(Number.isNaN(values[5]));
        assert.equal(values[6], 10);
        await assert.rejects(readAttributeColumns(resource, ['missing']), /Unknown Gaussian property/);
    } finally { pool.destroy(); }
});
