import type { FileSystem, ReadFileSystem } from '@playcanvas/splat-transform';

import type { Splat } from '../splat';
import { readBytes } from './bgs-loader';
import type { BgsData } from './bgs-types';

const writeBytes = async (fs: FileSystem, name: string, bytes: Uint8Array): Promise<void> => {
    const writer = await fs.createWriter(name);
    await writer.write(bytes);
    await writer.close();
};

const writeAnimationAsset = async (fs: FileSystem, prefix: string, data: BgsData): Promise<void> => {
    const scene = structuredClone(data.scene);
    scene.gaussians.uri = 'gaussians.ply';
    scene.animation.uri = 'animation.bin';
    await writeBytes(fs, `${prefix}/scene.json`, new TextEncoder().encode(JSON.stringify(scene)));
    await writeBytes(fs, `${prefix}/gaussians.ply`, data.gaussians.bytes);
    await writeBytes(fs, `${prefix}/animation.bin`, data.animationBytes);
};

const encodeCanonicalEdits = (splat: Splat): Uint8Array | undefined => {
    const { canonicalEdits, count } = splat.instances;
    if (!canonicalEdits) return undefined;
    const bytes = new Uint8Array(count * 16 * 8);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < count * 16; i++) view.setFloat64(i * 8, canonicalEdits[i], true);
    return bytes;
};

const readCanonicalEdits = async (fs: ReadFileSystem, name: string, count: number, capacity: number): Promise<Float64Array> => {
    const bytes = await readBytes(fs, name);
    if (bytes.length !== count * 16 * 8) throw new Error('Invalid canonical edit buffer length');
    const result = new Float64Array(capacity * 16);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < count * 16; i++) {
        const value = view.getFloat64(i * 8, true);
        if (!Number.isFinite(value)) throw new Error('Non-finite canonical edit');
        result[i] = value;
    }
    for (let i = 0; i < count; i++) {
        if (result[i * 16 + 3] !== 0 || result[i * 16 + 7] !== 0 || result[i * 16 + 11] !== 0 || result[i * 16 + 15] !== 1) {
            throw new Error('Canonical edit must be affine');
        }
    }
    return result;
};

export { encodeCanonicalEdits, readCanonicalEdits, writeAnimationAsset, writeBytes };
