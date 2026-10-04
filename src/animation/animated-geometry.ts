import {
    BUFFERUSAGE_COPY_DST, BUFFERUSAGE_COPY_SRC, BindGroupFormat, BindStorageBufferFormat, BindStorageTextureFormat, BindTextureFormat, BindUniformBufferFormat,
    BoundingBox, Compute, GraphicsDevice, Mat4, PIXELFORMAT_RGBA32F, PIXELFORMAT_RGBA32U, SAMPLETYPE_UINT,
    SAMPLETYPE_UNFILTERABLE_FLOAT, SHADERLANGUAGE_WGSL, SHADERSTAGE_COMPUTE, Shader, Texture,
    StorageBuffer, UNIFORMTYPE_FLOAT, UNIFORMTYPE_MAT4, UNIFORMTYPE_UINT, UniformBufferFormat, UniformFormat, Vec2
} from 'playcanvas';

import { paletteMatrixWGSL } from '../shaders/palette-chunk';
import type { Splat } from '../splat';
import { BgsFrame, BgsProvider } from './bgs-provider';
import { conjugateEdit, multiplyAffine } from './canonical-edit';

type CanonicalSnapshot = { indices: Uint32Array; matrices: Float64Array };

const staticTextures = new WeakMap<GraphicsDevice, Texture>();
const staticPoseTexture = (device: GraphicsDevice): Texture => {
    let texture = staticTextures.get(device);
    if (!texture) {
        texture = new Texture(device, { name: 'no-animation', width: 1, height: 1, format: PIXELFORMAT_RGBA32F, mipmaps: false });
        (texture.lock() as Float32Array).fill(0);
        texture.unlock();
        texture.upload();
        staticTextures.set(device, texture);
    }
    return texture;
};

const source = /* wgsl */`
struct Uniforms { count: u32, bindingWidth: u32, matrixWidth: u32, nodeWidth: u32, epsilon: f32, previewEnabled: u32, previewEdit: mat4x4f }
@group(0) @binding(0) var<storage, read> instanceSource: array<u32>;
@group(0) @binding(1) var<storage, read> instancePalette: array<u32>;
@group(0) @binding(2) var<storage, read> instanceFlags: array<u32>;
@group(0) @binding(3) var<storage, read_write> fallbackCount: atomic<u32>;
@group(0) @binding(4) var nodes: texture_2d<u32>;
@group(0) @binding(5) var weights: texture_2d<f32>;
@group(0) @binding(6) var deltas: texture_2d<f32>;
@group(0) @binding(7) var transformPalette: texture_2d<f32>;
@group(0) @binding(8) var canonicalEdits: texture_2d<f32>;
@group(0) @binding(9) var result: texture_storage_2d<rgba32float, write>;
@group(0) @binding(10) var<uniform> uniforms: Uniforms;
${paletteMatrixWGSL}
fn canonicalMatrix(i: u32) -> mat4x4f {
    if (textureDimensions(canonicalEdits).x == 1u) { return paletteMatrix(instancePalette[i] & 0xffffu); }
    let perRow = textureDimensions(canonicalEdits).x / 4u;
    let uv = vec2i(i32(i % perRow) * 4, i32(i / perRow));
    let a = textureLoad(canonicalEdits, uv, 0);
    let b = textureLoad(canonicalEdits, uv + vec2i(1, 0), 0);
    let c = textureLoad(canonicalEdits, uv + vec2i(2, 0), 0);
    return mat4x4f(vec4f(a.x, b.x, c.x, 0.0), vec4f(a.y, b.y, c.y, 0.0),
        vec4f(a.z, b.z, c.z, 0.0), vec4f(a.w, b.w, c.w, 1.0));
}
fn qmul(a: vec4f, b: vec4f) -> vec4f {
    return vec4f(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz));
}
fn nodeDQ(index: u32, half: u32) -> vec4f {
    let entry = index * 2u + half;
    return textureLoad(deltas, vec2i(i32(entry % uniforms.nodeWidth), i32(entry / uniforms.nodeWidth)), 0);
}
fn rotate(q: vec4f, v: vec3f) -> vec3f {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}
fn nodeColor(node: u32) -> vec3f {
    if (node == 0u) { return vec3f(0.48); }
    let hue = fract(f32(node) * 0.61803398875);
    let rgb = clamp(abs(fract(vec3f(hue) + vec3f(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));
    return mix(vec3f(1.0), rgb, 0.65) * 0.9;
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) groups: vec3u) {
    let i = id.y * groups.x * 256u + id.x;
    if (i >= uniforms.count) { return; }
    let row = instanceSource[i];
    let uv = vec2i(i32(row % uniforms.bindingWidth), i32(row / uniforms.bindingWidth));
    let js = textureLoad(nodes, uv, 0);
    let ws = textureLoad(weights, uv, 0);
    var pivot = 0u;
    for (var k = 1u; k < 4u; k++) {
        if (ws[k] > ws[pivot] || (ws[k] == ws[pivot] && js[k] < js[pivot])) { pivot = k; }
    }
    let reference = nodeDQ(js[pivot], 0u);
    var real = vec4f(0.0);
    var dual = vec4f(0.0);
    for (var k = 0u; k < 4u; k++) {
        if (ws[k] == 0.0) { continue; }
        let r = nodeDQ(js[k], 0u);
        let d = nodeDQ(js[k], 1u);
        let sign = select(1.0, -1.0, dot(r, reference) < 0.0);
        real += ws[k] * sign * r;
        dual += ws[k] * sign * d;
    }
    let n = length(real);
    if (n < uniforms.epsilon) {
        atomicAdd(&fallbackCount, 1u);
        real = reference;
        dual = nodeDQ(js[pivot], 1u);
    } else {
        real /= n;
        dual /= n;
        dual -= real * dot(real, dual);
    }
    let translation = 2.0 * qmul(dual, vec4f(-real.xyz, real.w)).xyz;
    let deformation = mat4x4f(vec4f(rotate(real, vec3f(1.0, 0.0, 0.0)), 0.0),
        vec4f(rotate(real, vec3f(0.0, 1.0, 0.0)), 0.0),
        vec4f(rotate(real, vec3f(0.0, 0.0, 1.0)), 0.0), vec4f(translation, 1.0));
    var matrix = deformation * canonicalMatrix(i);
    let flag = (instanceFlags[i / 4u] >> ((i % 4u) * 8u)) & 255u;
    if (uniforms.previewEnabled != 0u && flag == 1u) { matrix = uniforms.previewEdit * matrix; }
    let perRow = uniforms.matrixWidth / 4u;
    let dst = vec2i(i32(i % perRow) * 4, i32(i / perRow));
    textureStore(result, dst, vec4f(matrix[0].x, matrix[1].x, matrix[2].x, matrix[3].x));
    textureStore(result, dst + vec2i(1, 0), vec4f(matrix[0].y, matrix[1].y, matrix[2].y, matrix[3].y));
    textureStore(result, dst + vec2i(2, 0), vec4f(matrix[0].z, matrix[1].z, matrix[2].z, matrix[3].z));
    textureStore(result, dst + vec2i(3, 0), vec4f(nodeColor(js[pivot]), f32(js[pivot])));
}`;

/** BGS backend. The resulting atlas is provider-neutral to geometry consumers. */
class AnimatedGeometry {
    clipId: string;
    bindPose = false;
    frame: BgsFrame | null = null;
    poseTexture: Texture;
    readonly sourceRows: Uint32Array;
    private canonicalTexture: Texture | null = null;
    private canonicalData: Float32Array | null = null;
    private canonicalVersion = -1;
    private previewEdit = new Mat4();
    private previewEnabled = false;
    private editFrame: BgsFrame | null = null;
    fallbackCount = 0;
    private counter: StorageBuffer;
    private counterData = new Uint32Array(1);
    private backPoseTexture: Texture;
    private nodes: Texture;
    private weights: Texture;
    private deltas: Texture;
    private deltaData: Float32Array;
    private compute: Compute;
    private shader: Shader;
    private format: BindGroupFormat;
    private dispatchSize = new Vec2();
    private request = 0;
    private disposed = false;

    constructor(readonly splat: Splat, readonly provider: BgsProvider, sourceRows?: Uint32Array) {
        const { device } = splat.resource;
        const data = provider.data;
        this.clipId = provider.asset.clips[0].id;
        this.sourceRows = sourceRows ?? Uint32Array.from({ length: data.gaussians.count }, (_, i) => i);
        const width = Math.max(1, Math.ceil(Math.sqrt(data.gaussians.count)));
        const height = Math.ceil(data.gaussians.count / width);
        const make = (name: string, format: number, w: number, h: number, storage = false) => new Texture(device, { name, width: w, height: h, format, mipmaps: false, storage });
        this.nodes = make('bgs-nodes', PIXELFORMAT_RGBA32U, width, height);
        this.weights = make('bgs-weights', PIXELFORMAT_RGBA32F, width, height);
        const nodes = this.nodes.lock() as Uint32Array;
        const weights = this.weights.lock() as Float32Array;
        for (let row = 0; row < this.sourceRows.length; row++) {
            const index = this.sourceRows[row];
            nodes.set(data.gaussians.bindNodes.subarray(index * 4, index * 4 + 4), row * 4);
            weights.set(data.gaussians.bindWeights.subarray(index * 4, index * 4 + 4), row * 4);
        }
        this.nodes.unlock();
        this.weights.unlock();
        this.nodes.upload();
        this.weights.upload();
        const nodeWidth = Math.min(4096, data.scene.nodes.length) * 2;
        this.deltas = make('bgs-deltas', PIXELFORMAT_RGBA32F, nodeWidth, Math.ceil(data.scene.nodes.length * 2 / nodeWidth));
        this.deltaData = this.deltas.lock() as Float32Array;
        this.deltas.unlock();
        const perRow = Math.min(Math.floor(device.maxTextureSize / 4), Math.max(1, Math.ceil(Math.sqrt(splat.instances.sourceRow.length))));
        this.poseTexture = make('posed-instance-transforms', PIXELFORMAT_RGBA32F, perRow * 4, Math.ceil(splat.instances.sourceRow.length / perRow), true);
        this.backPoseTexture = make('pending-instance-transforms', PIXELFORMAT_RGBA32F, this.poseTexture.width, this.poseTexture.height, true);
        const uniforms = new UniformBufferFormat(device, [
            new UniformFormat('count', UNIFORMTYPE_UINT), new UniformFormat('bindingWidth', UNIFORMTYPE_UINT),
            new UniformFormat('matrixWidth', UNIFORMTYPE_UINT), new UniformFormat('nodeWidth', UNIFORMTYPE_UINT),
            new UniformFormat('epsilon', UNIFORMTYPE_FLOAT),
            new UniformFormat('previewEnabled', UNIFORMTYPE_UINT), new UniformFormat('previewEdit', UNIFORMTYPE_MAT4)
        ]);
        this.counter = new StorageBuffer(device, 4, BUFFERUSAGE_COPY_DST | BUFFERUSAGE_COPY_SRC);
        this.format = new BindGroupFormat(device, [
            new BindStorageBufferFormat('instanceSource', SHADERSTAGE_COMPUTE, true),
            new BindStorageBufferFormat('instancePalette', SHADERSTAGE_COMPUTE, true),
            new BindStorageBufferFormat('instanceFlags', SHADERSTAGE_COMPUTE, true),
            new BindStorageBufferFormat('fallbackCount', SHADERSTAGE_COMPUTE),
            new BindTextureFormat('nodes', SHADERSTAGE_COMPUTE, undefined, SAMPLETYPE_UINT, false),
            new BindTextureFormat('weights', SHADERSTAGE_COMPUTE, undefined, SAMPLETYPE_UNFILTERABLE_FLOAT, false),
            new BindTextureFormat('deltas', SHADERSTAGE_COMPUTE, undefined, SAMPLETYPE_UNFILTERABLE_FLOAT, false),
            new BindTextureFormat('transformPalette', SHADERSTAGE_COMPUTE, undefined, SAMPLETYPE_UNFILTERABLE_FLOAT, false),
            new BindTextureFormat('canonicalEdits', SHADERSTAGE_COMPUTE, undefined, SAMPLETYPE_UNFILTERABLE_FLOAT, false),
            new BindStorageTextureFormat('result', PIXELFORMAT_RGBA32F),
            new BindUniformBufferFormat('uniforms', SHADERSTAGE_COMPUTE)
        ]);
        this.shader = new Shader(device, { name: 'BgsDeform',
            shaderLanguage: SHADERLANGUAGE_WGSL,
            cshader: source,
            computeBindGroupFormat: this.format,
            computeUniformBufferFormats: { uniforms } } as any);
        this.compute = new Compute(device, this.shader, 'BgsDeform');
    }

    invalidate(): void {
        this.request++;
    }

    async prepare(time: number): Promise<void> {
        const version = ++this.request;
        const scene = this.splat.scene;
        if (!scene || this.disposed) return;
        const frame = await this.provider.prepare(this.bindPose ? '__bind__' : this.clipId, time, version);
        if (this.disposed || version !== this.request) return;
        this.dispatch(frame, this.backPoseTexture);
        const counterRead = this.counter.read(0, 4, this.counterData, false);
        const selection = new BoundingBox();
        const local = new BoundingBox();
        await scene.dataProcessor.calcBound(this.splat, selection, local, this.backPoseTexture);
        await counterRead;
        if (this.disposed || version !== this.request || this.splat.scene !== scene) return;
        // Publish texture, CPU frame and bounds together, only after the reduction completes.
        [this.poseTexture, this.backPoseTexture] = [this.backPoseTexture, this.poseTexture];
        this.frame = frame;
        this.fallbackCount = this.counterData[0];
        this.splat.commitAnimationBounds(selection, local);
        this.splat.changedCounter++;
        scene.forceRender = true;
        scene.boundDirty = true;
        scene.events.fire('animation.frame', this.splat);
    }

    dispatch(frame = this.frame, target = this.poseTexture): void {
        if (!frame || this.disposed || !this.splat.instances.count) return;
        frame.deltas.forEach((dq, i) => {
            this.deltaData.set(dq.real, i * 8);
            this.deltaData.set(dq.dual, i * 8 + 4);
        });
        this.deltas.upload();
        this.counterData[0] = 0;
        this.counter.write(0, this.counterData);
        const compute = this.compute;
        compute.setParameter('fallbackCount', this.counter);
        compute.setParameter('previewEnabled', this.previewEnabled ? 1 : 0);
        compute.setParameter('previewEdit', this.previewEdit.data);
        compute.setParameter('instanceFlags', this.splat.instances.instanceFlags);
        compute.setParameter('canonicalEdits', this.syncCanonical());
        compute.setParameter('instanceSource', this.splat.instances.instanceSource);
        compute.setParameter('instancePalette', this.splat.instances.instancePalette);
        compute.setParameter('nodes', this.nodes);
        compute.setParameter('weights', this.weights);
        compute.setParameter('deltas', this.deltas);
        compute.setParameter('transformPalette', this.splat.transformPalette.texture);
        compute.setParameter('result', target);
        compute.setParameter('count', this.splat.instances.count);
        compute.setParameter('bindingWidth', this.nodes.width);
        compute.setParameter('matrixWidth', target.width);
        compute.setParameter('nodeWidth', this.deltas.width);
        compute.setParameter('epsilon', this.provider.data.scene.skinning.epsilon);
        Compute.calcDispatchSize(Math.ceil(this.splat.instances.count / 256), this.dispatchSize);
        compute.setupDispatch(this.dispatchSize.x, this.dispatchSize.y);
        this.splat.resource.device.computeDispatch([compute], 'BGS-deformation');
    }

    private syncCanonical(): Texture {
        const { instances } = this.splat;
        if (!instances.canonicalEdits) return staticPoseTexture(this.splat.resource.device);
        if (!this.canonicalTexture) {
            this.canonicalTexture = new Texture(this.splat.resource.device, { name: 'canonical-edits',
                width: this.poseTexture.width,
                height: this.poseTexture.height,
                format: PIXELFORMAT_RGBA32F,
                mipmaps: false });
            this.canonicalData = this.canonicalTexture.lock() as Float32Array;
            this.canonicalTexture.unlock();
        }
        if (this.canonicalVersion !== instances.canonicalVersion) {
            const matrices = instances.canonicalEdits;
            for (let i = 0; i < instances.count; i++) {
                for (let row = 0; row < 3; row++) {
                    for (let col = 0; col < 4; col++) {
                        this.canonicalData[i * 16 + row * 4 + col] = matrices[i * 16 + col * 4 + row];
                    }
                }
            }
            this.canonicalTexture.upload();
            this.canonicalVersion = instances.canonicalVersion;
        }
        return this.canonicalTexture;
    }

    readCanonical(instance: number, output: Float64Array): void {
        const { instances } = this.splat;
        if (instances.canonicalEdits) output.set(instances.canonicalEdits.subarray(instance * 16, instance * 16 + 16));
        else {
            const matrix = new Mat4();
            this.splat.transformPalette.getTransform(instances.transformIndex(instance), matrix);
            output.set(matrix.data);
        }
    }

    beginEdit(indices?: Uint32Array): CanonicalSnapshot {
        if (!this.frame) throw new Error('Animation pose is not ready');
        this.splat.scene.events.fire('animation.freeze');
        this.editFrame = this.frame;
        const selected = indices ?? Uint32Array.from(Array.from({ length: this.splat.instances.count }, (_, i) => i)
        .filter(i => this.splat.instances.flags[i] === 1));
        const snapshot = { indices: selected, matrices: new Float64Array(selected.length * 16) };
        selected.forEach((instance, i) => this.readCanonical(instance, snapshot.matrices.subarray(i * 16, i * 16 + 16)));
        return snapshot;
    }

    preview(matrix: Mat4): void {
        this.previewEdit.copy(matrix);
        this.previewEnabled = true;
        this.dispatch();
        this.splat.changedCounter++;
        this.splat.scene.forceRender = true;
    }

    finishEdit(edit: Mat4, before: CanonicalSnapshot): CanonicalSnapshot {
        if (!this.editFrame) throw new Error('No frozen editing pose');
        const after = { indices: before.indices.slice(), matrices: new Float64Array(before.matrices.length) };
        const deformation = new Float64Array(16);
        before.indices.forEach((instance, i) => {
            this.editFrame.readDeformation(this.sourceRows[this.splat.instances.sourceRow[instance]], deformation);
            after.matrices.set(conjugateEdit(deformation, edit.data, before.matrices.subarray(i * 16, i * 16 + 16)), i * 16);
        });
        this.editFrame = null;
        this.restoreEdit(after);
        return after;
    }

    restoreEdit(snapshot: CanonicalSnapshot): void {
        const { instances } = this.splat;
        if (!instances.canonicalEdits) {
            const edits = new Float64Array(instances.sourceRow.length * 16);
            for (let i = 0; i < instances.count; i++) this.readCanonical(i, edits.subarray(i * 16, i * 16 + 16));
            instances.canonicalEdits = edits;
        }
        snapshot.indices.forEach((instance, i) => instances.canonicalEdits.set(snapshot.matrices.subarray(i * 16, i * 16 + 16), instance * 16));
        instances.canonicalVersion++;
        this.previewEnabled = false;
        this.dispatch();
    }

    readMatrix(instance: number, result: Mat4): void {
        if (!this.frame) throw new Error('Animation pose is not ready');
        const matrix = new Float64Array(16);
        const canonical = new Float64Array(16);
        this.frame.readDeformation(this.sourceRows[this.splat.instances.sourceRow[instance]], matrix);
        this.readCanonical(instance, canonical);
        result.data.set(multiplyAffine(matrix, canonical));
    }

    dispose(): void {
        this.disposed = true;
        this.request++;
        this.canonicalTexture?.destroy();
        this.counter.destroy();
        this.compute.destroy();
        this.shader.destroy();
        this.format.destroy();
        for (const texture of [this.nodes, this.weights, this.deltas, this.poseTexture, this.backPoseTexture]) texture.destroy();
        this.provider.dispose();
    }
}

export { AnimatedGeometry, staticPoseTexture };
export type { CanonicalSnapshot };
