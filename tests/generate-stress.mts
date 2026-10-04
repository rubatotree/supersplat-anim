import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { MemoryReadFileSystem } from '@playcanvas/splat-transform';

import { loadBgs } from '../src/animation/bgs-loader';

const root = resolve(process.argv[2] ?? '.git/bgs-synthetic-stress');
const fs = new MemoryReadFileSystem();
for (const name of ['scene.json', 'gaussians.ply', 'animation.bin']) fs.set(name, await readFile(new URL(`fixtures/bgs/${name}`, import.meta.url)));
const data = await loadBgs(fs, 'scene.json');
const g = data.gaussians;
const count = 350000;
const header = new TextEncoder().encode(new TextDecoder().decode(g.bytes.subarray(0, g.headerBytes)).replace(/element vertex \d+/, `element vertex ${count}`));
const bytes = new Uint8Array(header.length + count * g.stride);
bytes.set(header);
const view = new DataView(bytes.buffer);
const offsets = new Map(g.properties.map(property => [property.name, property.offset]));
for (let i = 0; i < count; i++) {
    const row = i % g.count;
    const base = header.length + i * g.stride;
    bytes.set(g.bytes.subarray(g.headerBytes + row * g.stride, g.headerBytes + (row + 1) * g.stride), base);
    [((i % 100) - 49.5) * 0.025, ((Math.floor(i / 100) % 100) - 49.5) * 0.025, (Math.floor(i / 10000) - 17) * 0.025]
    .forEach((value, k) => view.setFloat32(base + offsets.get(['x', 'y', 'z'][k]), value, true));
    view.setUint32(base + offsets.get('source_gaussian_id'), i, true);
    for (let k = 0; k < 4; k++) {
        view.setUint32(base + offsets.get(`bind_node_${k}`), k === 0 && i % 2 ? 1 + i % 4 : 0, true);
        view.setFloat32(base + offsets.get(`bind_weight_${k}`), k === 0 ? 1 : 0, true);
        view.setFloat32(base + offsets.get(`rot_${k}`), k === 0 ? 1 : 0, true);
        if (k < 3) view.setFloat32(base + offsets.get(`scale_${k}`), Math.log(0.006), true);
    }
}
data.scene.asset.id = 'supersplat-synthetic-stress-350k';
data.scene.asset.name = 'Synthetic 350k animation stress scene';
data.scene.asset.extras = { classification: 'synthetic_pressure_test_not_real_capture' };
data.scene.gaussians.count = count;
await mkdir(root, { recursive: true });
await writeFile(resolve(root, 'scene.json'), JSON.stringify(data.scene));
await writeFile(resolve(root, 'gaussians.ply'), bytes);
await writeFile(resolve(root, 'animation.bin'), data.animationBytes);
