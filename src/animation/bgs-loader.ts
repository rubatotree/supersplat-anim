import { ZipReadFileSystem, type ReadFileSystem, type ReadSource } from '@playcanvas/splat-transform';

import type { BgsData, BgsGaussians, BgsScene, PlyProperty } from './bgs-types';
import { compose, identityPose, inverse, normalizeQuat, poseMatrix, type RigidPose } from './math';

const fail = (message: string): never => {
    throw new Error(`BGS: ${message}`);
};
const vector = (value: unknown, count: number, name: string): number[] => {
    if (!Array.isArray(value) || value.length !== count || value.some(x => typeof x !== 'number' || !Number.isFinite(x))) fail(`Invalid ${name}`);
    return value as number[];
};
const integer = (value: number, minimum: number, name: string): void => {
    if (!Number.isSafeInteger(value) || value < minimum) fail(`Invalid ${name}`);
};
const unitQuat = (value: unknown, name: string): number[] => {
    const q = vector(value, 4, name);
    if (Math.abs(Math.hypot(...q) - 1) > 2e-3) fail(`${name} must be a unit quaternion`);
    return normalizeQuat(q);
};
const isIdentity = (pose: RigidPose): boolean => Math.hypot(...pose.translation) < 1e-5 &&
    Math.hypot(...pose.rotation.slice(0, 3)) < 1e-5 && Math.abs(Math.abs(pose.rotation[3]) - 1) < 1e-5;

/** Reject encoded separators too: URL file systems may decode them after joining. */
const safeAssetPath = (filename: string, uri: string): string => {
    if (typeof uri !== 'string' || !uri || /[\\:%?#]/.test(uri) || uri.startsWith('/') ||
        uri.split('/').some(part => !part || part === '..' || part === '.')) fail(`Unsafe asset URI: ${uri}`);
    if (/[\\:%?#]/.test(filename) || filename.startsWith('/') || filename.split('/').includes('..')) fail('Unsafe scene path');
    return filename.slice(0, filename.lastIndexOf('/') + 1) + uri;
};

const validateScene = (value: unknown, animationBytes: Uint8Array): { scene: BgsScene; bindGlobals: RigidPose[] } => {
    const scene = value as BgsScene;
    if (!scene || scene.format !== 'bound-gaussian-scene' || scene.version !== '0.1.0') fail('Unsupported format or version');
    if (!Array.isArray(scene.extensions_required) || scene.extensions_required.length) fail('Unsupported required extension');
    for (const key of ['asset', 'coordinate_system', 'gaussians', 'skinning', 'animation', 'normalization']) {
        if (!scene[key as keyof BgsScene] || typeof scene[key as keyof BgsScene] !== 'object') fail(`Missing ${key}`);
    }
    for (const key of ['id', 'name', 'quality_status'] as const) {
        if (typeof scene.asset[key] !== 'string' || !scene.asset[key]) fail(`Missing asset.${key}`);
    }
    const coordinate = scene.coordinate_system;
    if (coordinate.handedness !== 'right' || coordinate.unit !== 'meter' || coordinate.up_axis !== '+Z' ||
        coordinate.forward_axis !== '+X' || coordinate.left_axis !== '+Y') fail('Unsupported coordinates');
    if (coordinate.anchor?.type !== 'robot_base_support_center' || !coordinate.anchor.method) fail('Missing coordinate anchor');
    const normalization = scene.normalization;
    const h = vector(normalization.source_to_scene, 16, 'normalization matrix');
    if (Math.max(Math.abs(h[3]), Math.abs(h[7]), Math.abs(h[11]), Math.abs(h[15] - 1)) > 1e-6) fail('Invalid normalization homogeneous row');
    const columns = [h.slice(0, 3), h.slice(4, 7), h.slice(8, 11)];
    const scales = columns.map(c => Math.hypot(...c));
    const scale = scales[0];
    if (scale <= 0 || scales.some(s => Math.abs(s - scale) > 1e-5 * scale)) fail('Non-uniform normalization');
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < i; j++) {
            if (Math.abs(columns[i].reduce((sum, x, k) => sum + x * columns[j][k], 0)) > 1e-5 * scale * scale) fail('Normalization contains shear');
        }
    }
    const [a, b, c] = columns;
    const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
    if (det <= 0 || !Number.isFinite(normalization.source_units_per_meter) || normalization.source_units_per_meter <= 0 ||
        Math.abs(scale - 1 / normalization.source_units_per_meter) > scale * 1e-5 ||
        !normalization.method || !normalization.source_calibration_status) fail('Invalid normalization provenance');
    if (!Array.isArray(scene.nodes) || !scene.nodes.length) fail('Missing nodes');
    const bindGlobals: RigidPose[] = [];
    scene.nodes.forEach((node, index) => {
        if (!node || node.index !== index || typeof node.name !== 'string' || !node.name) fail(`Invalid node ${index}`);
        if (index === 0 ? node.parent !== -1 || node.name !== 'scene' : !Number.isInteger(node.parent) || node.parent < 0 || node.parent >= index) fail(`Invalid parent for node ${index}`);
        const local: RigidPose = {
            translation: vector(node.bind_local?.translation, 3, 'bind translation'),
            rotation: unitQuat(node.bind_local?.rotation_xyzw, 'bind rotation')
        };
        if (index === 0 && !isIdentity(local)) fail('Root bind pose must be identity');
        const global = index === 0 ? identityPose() : compose(bindGlobals[node.parent], local);
        bindGlobals.push(global);
        const cached = vector(node.inverse_bind_matrix, 16, 'inverse bind');
        const expected = poseMatrix(inverse(global));
        if (cached.some((x, i) => Math.abs(x - expected[i]) > 2e-4)) fail(`Inverse bind mismatch at node ${index}`);
    });
    integer(coordinate.anchor.robot_root_node, 0, 'anchor node');
    if (coordinate.anchor.robot_root_node >= scene.nodes.length) fail('Anchor node out of range');
    const skin = scene.skinning;
    if (skin.method !== 'dual_quaternion' || skin.near_zero_fallback !== 'dominant_influence' || !Number.isFinite(skin.epsilon) || skin.epsilon <= 0) fail('Unsupported skinning');
    const g = scene.gaussians;
    integer(g.count, 1, 'Gaussian count');
    if (![0, 1, 2].includes(g.sh_degree) || g.sh_basis !== 'graphdeco_real_sh' || g.sh_direction !== 'camera_to_mean' ||
        g.sh_frame !== 'scene' || g.appearance_encoding !== 'source_numeric_rgb' || g.opacity_encoding !== 'logit' ||
        g.scale_encoding !== 'ln_std_meters' || g.rotation_encoding !== 'wxyz' || g.binding_slots !== 4) fail('Unsupported Gaussian encoding');
    const animation = scene.animation;
    if (animation.endianness !== 'little' || animation.component_type !== 'float32' || animation.record_stride_bytes !== 28 ||
        JSON.stringify(animation.record_layout) !== JSON.stringify(['tx', 'ty', 'tz', 'qx', 'qy', 'qz', 'qw']) ||
        animation.transform_space !== 'parent_local') fail('Unsupported animation encoding');
    if (!Array.isArray(animation.clips) || !animation.clips.length) fail('Missing animation clips');
    const ids = new Set<string>();
    const ranges: [number, number][] = [];
    const data = new DataView(animationBytes.buffer, animationBytes.byteOffset, animationBytes.byteLength);
    for (const clip of animation.clips) {
        if (typeof clip.id !== 'string' || !clip.id || ids.has(clip.id)) fail('Invalid or duplicate clip ID');
        ids.add(clip.id);
        integer(clip.frame_count, 1, 'frame count');
        integer(clip.byte_offset, 0, 'byte offset');
        integer(clip.byte_length, 0, 'byte length');
        if (clip.node_count !== scene.nodes.length || clip.byte_offset % 4 ||
            clip.byte_length !== clip.frame_count * clip.node_count * 28 || clip.byte_offset + clip.byte_length > data.byteLength) fail(`Invalid binary range: ${clip.id}`);
        const times = vector(clip.times_seconds, clip.frame_count, 'clip times');
        if (times[0] !== 0 || times.some((t, i) => i > 0 && t <= times[i - 1]) || !Number.isFinite(clip.duration_seconds) ||
            clip.duration_seconds <= times[times.length - 1]) fail(`Invalid time range: ${clip.id}`);
        if (!['step', 'linear_translation_slerp_rotation'].includes(clip.interpolation) || typeof clip.loop_default !== 'boolean') fail('Invalid clip playback policy');
        if (clip.source_frame_indices !== undefined) {
            vector(clip.source_frame_indices, clip.frame_count, 'source frames').forEach(v => integer(v, 0, 'source frame'));
        }
        ranges.push([clip.byte_offset, clip.byte_offset + clip.byte_length]);
        for (let f = 0; f < clip.frame_count; f++) {
            for (let n = 0; n < clip.node_count; n++) {
                const offset = clip.byte_offset + (f * clip.node_count + n) * 28;
                const values = Array.from({ length: 7 }, (_, k) => data.getFloat32(offset + k * 4, true));
                if (values.some(v => !Number.isFinite(v))) fail('Non-finite animation pose');
                const pose = { translation: values.slice(0, 3), rotation: unitQuat(values.slice(3), 'animation rotation') };
                if (n === 0 && !isIdentity(pose)) fail('Animated root must remain identity');
            }
        }
    }
    ranges.sort((x, y) => x[0] - y[0]);
    if (ranges.some((range, i) => i > 0 && range[0] < ranges[i - 1][1])) fail('Overlapping clips');
    if (!Array.isArray(scene.cameras)) fail('Missing cameras array');
    scene.cameras.forEach(camera => vector(camera.camera_to_scene, 16, 'camera matrix'));
    return { scene, bindGlobals };
};

const plyTypes: Record<string, [number, (view: DataView, offset: number) => number]> = {
    char: [1, (v, o) => v.getInt8(o)],
    uchar: [1, (v, o) => v.getUint8(o)],
    short: [2, (v, o) => v.getInt16(o, true)],
    ushort: [2, (v, o) => v.getUint16(o, true)],
    int: [4, (v, o) => v.getInt32(o, true)],
    uint: [4, (v, o) => v.getUint32(o, true)],
    float: [4, (v, o) => v.getFloat32(o, true)],
    double: [8, (v, o) => v.getFloat64(o, true)]
};
for (const [alias, type] of Object.entries({ int8: 'char', uint8: 'uchar', int16: 'short', uint16: 'ushort', int32: 'int', uint32: 'uint', float32: 'float', float64: 'double' })) plyTypes[alias] = plyTypes[type];

const parseGaussians = (bytes: Uint8Array, scene: BgsScene): BgsGaussians => {
    const prefix = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(bytes.length, 4 * 1024 * 1024)));
    const match = /^end_header\r?\n/m.exec(prefix);
    if (!match) fail('Missing or oversized PLY header');
    const headerBytes = match.index + match[0].length;
    const lines = prefix.slice(0, headerBytes).split(/\r?\n/);
    if (lines[0] !== 'ply' || !lines.includes('format binary_little_endian 1.0')) fail('Expected binary little-endian PLY');
    let count = -1;
    let stride = 0;
    const properties: PlyProperty[] = [];
    const names = new Set<string>();
    for (const line of lines) {
        const words = line.trim().split(/\s+/);
        if (words[0] === 'element') {
            if (count !== -1 || words[1] !== 'vertex' || words.length !== 3) fail('PLY must contain one vertex element');
            count = Number(words[2]);
            integer(count, 1, 'PLY count');
        } else if (words[0] === 'property') {
            const type = plyTypes[words[1]];
            if (count < 0 || words.length !== 3 || !type || names.has(words[2])) fail(`Invalid PLY property: ${line}`);
            names.add(words[2]);
            properties.push({ name: words[2], type: words[1], offset: stride, size: type[0] });
            stride += type[0];
        }
    }
    if (count !== scene.gaussians.count || !Number.isSafeInteger(count * stride) || bytes.length !== headerBytes + count * stride) fail('PLY count or payload length mismatch');
    const fields = new Map(properties.map(p => [p.name, p]));
    const requiredFloats = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity',
        ...Array.from({ length: 3 }, (_, i) => `scale_${i}`), ...Array.from({ length: 4 }, (_, i) => `rot_${i}`),
        ...Array.from({ length: 4 }, (_, i) => `bind_weight_${i}`),
        ...Array.from({ length: 3 * ((scene.gaussians.sh_degree + 1) ** 2 - 1) }, (_, i) => `f_rest_${i}`)];
    for (const name of requiredFloats) {
        if (!['float', 'float32'].includes(fields.get(name)?.type)) fail(`Missing float property: ${name}`);
    }
    const uints = ['source_gaussian_id', ...Array.from({ length: 4 }, (_, i) => `bind_node_${i}`)];
    for (const name of uints) {
        if (!['uint', 'uint32'].includes(fields.get(name)?.type)) fail(`Missing uint property: ${name}`);
    }
    const expectedRest = requiredFloats.filter(name => name.startsWith('f_rest_')).length;
    if (properties.filter(p => p.name.startsWith('f_rest_')).length !== expectedRest) fail('SH degree/property mismatch');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const read = (row: number, name: string): number => {
        const property = fields.get(name);
        return plyTypes[property.type][1](view, headerBytes + row * stride + property.offset);
    };
    const positions = new Float64Array(count * 3);
    const rotations = new Float64Array(count * 4);
    const logScales = new Float64Array(count * 3);
    const sourceIds = new Uint32Array(count);
    const bindNodes = new Uint32Array(count * 4);
    const bindWeights = new Float32Array(count * 4);
    const dominantNodes = new Uint32Array(count);
    const seen = new Set<number>();
    for (let row = 0; row < count; row++) {
        for (const property of properties) {
            if (!Number.isFinite(read(row, property.name))) fail(`Non-finite ${property.name} at row ${row}`);
        }
        const id = read(row, 'source_gaussian_id');
        if (seen.has(id)) fail(`Duplicate Gaussian ID: ${id}`);
        seen.add(id);
        sourceIds[row] = id;
        positions.set(['x', 'y', 'z'].map(name => read(row, name)), row * 3);
        logScales.set([0, 1, 2].map(i => read(row, `scale_${i}`)), row * 3);
        const q = [1, 2, 3, 0].map(i => read(row, `rot_${i}`));
        rotations.set(unitQuat(q, 'Gaussian rotation'), row * 4);
        const merged = new Map<number, number>();
        let total = 0;
        for (let slot = 0; slot < 4; slot++) {
            const node = read(row, `bind_node_${slot}`);
            const weight = read(row, `bind_weight_${slot}`);
            if (node >= scene.nodes.length || weight < 0) fail(`Invalid binding at row ${row}`);
            total += weight;
            if (weight > 0) merged.set(node, (merged.get(node) ?? 0) + weight);
        }
        if (Math.abs(total - 1) > 1e-5) fail(`Weights do not sum to one at row ${row}`);
        const influences = Array.from(merged, ([node, weight]) => ({ node, weight: weight / total }))
        .sort((x, y) => y.weight - x.weight || x.node - y.node);
        influences.forEach((influence, slot) => {
            bindNodes[row * 4 + slot] = influence.node;
            bindWeights[row * 4 + slot] = influence.weight;
        });
        dominantNodes[row] = influences[0].node;
    }
    return { count, bytes, headerBytes, stride, properties, positions, rotations, logScales, sourceIds, bindNodes, bindWeights, dominantNodes };
};

const readBytes = async (fileSystem: ReadFileSystem, filename: string): Promise<Uint8Array> => {
    const source = await fileSystem.createSource(filename);
    try {
        return await source.read().readAll();
    } finally {
        source.close();
    }
};
const loadBgs = async (fileSystem: ReadFileSystem, filename: string, signal?: AbortSignal): Promise<BgsData> => {
    signal?.throwIfAborted();
    const value = JSON.parse(new TextDecoder().decode(await readBytes(fileSystem, filename))) as BgsScene;
    const animationPath = safeAssetPath(filename, value.animation?.uri);
    const gaussianPath = safeAssetPath(filename, value.gaussians?.uri);
    const animationBytes = await readBytes(fileSystem, animationPath);
    const validated = validateScene(value, animationBytes);
    signal?.throwIfAborted();
    const gaussians = parseGaussians(await readBytes(fileSystem, gaussianPath), validated.scene);
    signal?.throwIfAborted();
    return { ...validated, gaussians, animationBytes };
};

/** Takes ownership of the archive. No scripts or files are extracted to disk. */
const loadBgsZip = async (source: ReadSource, signal?: AbortSignal): Promise<BgsData> => {
    const fileSystem = new ZipReadFileSystem(source);
    try {
        const names = await fileSystem.list();
        for (const name of names) {
            safeAssetPath('scene.json', name.endsWith('/') ? name.slice(0, -1) : name);
        }
        const scenes = names.filter(name => name === 'scene.json' || name.endsWith('/scene.json'));
        if (scenes.length !== 1) fail('ZIP must contain exactly one scene.json');
        return await loadBgs(fileSystem, scenes[0], signal);
    } finally {
        fileSystem.close();
    }
};

export { loadBgs, loadBgsZip, parseGaussians, readBytes, safeAssetPath, validateScene };
