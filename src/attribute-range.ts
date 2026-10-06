import {
    BUFFERUSAGE_COPY_DST, BUFFERUSAGE_COPY_SRC, BindGroupFormat, BindStorageBufferFormat, BindTextureFormat, BindUniformBufferFormat,
    Compute, GraphicsDevice, SAMPLETYPE_UINT, SAMPLETYPE_FLOAT, SAMPLETYPE_UNFILTERABLE_FLOAT, SHADERLANGUAGE_WGSL, SHADERSTAGE_COMPUTE,
    Shader, StorageBuffer, UNIFORMTYPE_MAT4, UNIFORMTYPE_UINT, UNIFORMTYPE_FLOAT, UniformBufferFormat, UniformFormat, Texture, Mat4
} from 'playcanvas';

import { ATTRIBUTE_MODES, type AttributeMode } from './attribute-render';
import { attributeWGSL } from './shaders/attribute-chunk';
import { instanceGeometryWGSL } from './shaders/instance-geometry-chunk';
import { paletteMatrixWGSL } from './shaders/palette-chunk';
import type { Splat } from './splat';

const source = /* wgsl */`
struct Uniforms { count: u32, width: u32, mode: u32, preview: u32, previewAlpha: f32, model: mat4x4f, view: mat4x4f }
@group(0) @binding(0) var<storage, read_write> result: array<atomic<u32>>;
@group(0) @binding(1) var<storage, read> instanceSource: array<u32>;
@group(0) @binding(2) var<storage, read> instanceFlags: array<u32>;
@group(0) @binding(3) var<storage, read> instancePalette: array<u32>;
@group(0) @binding(4) var transformA: texture_2d<u32>;
@group(0) @binding(5) var transformPalette: texture_2d<f32>;
@group(0) @binding(6) var posedTransforms: texture_2d<f32>;
@group(0) @binding(7) var attributeData: texture_2d<f32>;
@group(0) @binding(8) var splatColor: texture_2d<f32>;
@group(0) @binding(9) var colorPalette: texture_2d<f32>;
@group(0) @binding(10) var<uniform> uniforms: Uniforms;
${paletteMatrixWGSL}
${instanceGeometryWGSL}
${attributeWGSL}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
    let i = gid.y * groups.x * 256u + gid.x;
    if (i >= uniforms.count) { return; }
    let flags = (instanceFlags[i >> 2u] >> ((i & 3u)*8u)) & 0xffu;
    if ((flags & 4u) != 0u) { return; }
    let row = instanceSource[i];
    let uv = vec2i(i32(row % uniforms.width), i32(row / uniforms.width));
    let pos = bitcast<vec3f>(textureLoad(transformA, uv, 0).xyz);
    let depth = -(uniforms.view * uniforms.model * instanceMatrix(i, instancePalette[i] & 0xffffu) * vec4f(pos,1)).z;
    let paletteIndex = instancePalette[i] >> 16u;
    let paletteWidth = textureDimensions(colorPalette).x;
    let alphaEntry = paletteIndex * 4u + 3u;
    let alphaUv = vec2i(i32(alphaEntry % paletteWidth), i32(alphaEntry / paletteWidth));
    var alpha = textureLoad(splatColor, uv, 0).a * textureLoad(colorPalette, alphaUv, 0).x;
    if ((flags & 2u) == 0u && (uniforms.preview == 2u || (uniforms.preview == 1u && (flags & 1u) != 0u))) { alpha *= uniforms.previewAlpha; }
    let v = attributeValue(uniforms.mode, uv, depth, clamp(alpha,0.0,1.0));
    if (!finiteValue(v) || (uniforms.mode == 1u && depth <= 0.0)) { return; }
    atomicMin(&result[0], orderedFloat(v));
    atomicMax(&result[1], orderedFloat(v));
    atomicAdd(&result[2], 1u);
}`;

class AttributeRange {
    readonly buffer: StorageBuffer;
    private shader: Shader;
    private format: BindGroupFormat;
    private compute: Compute;

    constructor(private device: GraphicsDevice) {
        this.buffer = new StorageBuffer(device, 12, BUFFERUSAGE_COPY_DST | BUFFERUSAGE_COPY_SRC);
        const uniforms = new UniformBufferFormat(device, [
            ...['count', 'width', 'mode', 'preview'].map(n => new UniformFormat(n, UNIFORMTYPE_UINT)),
            new UniformFormat('previewAlpha', UNIFORMTYPE_FLOAT),
            new UniformFormat('model', UNIFORMTYPE_MAT4), new UniformFormat('view', UNIFORMTYPE_MAT4)
        ]);
        const tex = (n: string, type: number) => new BindTextureFormat(n, SHADERSTAGE_COMPUTE, undefined, type, false);
        this.format = new BindGroupFormat(device, [
            new BindStorageBufferFormat('result', SHADERSTAGE_COMPUTE, false),
            ...['instanceSource', 'instanceFlags', 'instancePalette'].map(n => new BindStorageBufferFormat(n, SHADERSTAGE_COMPUTE, true)),
            tex('transformA', SAMPLETYPE_UINT), tex('transformPalette', SAMPLETYPE_UNFILTERABLE_FLOAT),
            tex('posedTransforms', SAMPLETYPE_UNFILTERABLE_FLOAT), tex('attributeData', SAMPLETYPE_UNFILTERABLE_FLOAT),
            tex('splatColor', SAMPLETYPE_FLOAT), tex('colorPalette', SAMPLETYPE_UNFILTERABLE_FLOAT),
            new BindUniformBufferFormat('uniforms', SHADERSTAGE_COMPUTE)
        ]);
        this.shader = new Shader(device, { name: 'AttributeRange',
            shaderLanguage: SHADERLANGUAGE_WGSL,
            cshader: source,
            computeBindGroupFormat: this.format,
            computeUniformBufferFormats: { uniforms } });
        this.compute = new Compute(device, this.shader, 'AttributeRange');
    }

    update(splat: Splat, texture: Texture, view: Mat4, preview: number, previewAlpha: number, mode: AttributeMode) {
        this.buffer.write(0, new Uint32Array([0xffffffff, 0, 0]));
        const c = this.compute;
        c.setParameter('result', this.buffer);
        for (const name of ['instanceSource', 'instanceFlags', 'instancePalette'] as const) c.setParameter(name, splat.instances[name]);
        c.setParameter('transformA', splat.resource.getTexture('transformA'));
        c.setParameter('transformPalette', splat.transformPalette.texture);
        c.setParameter('posedTransforms', splat.posedTransforms);
        c.setParameter('attributeData', texture);
        c.setParameter('splatColor', splat.resource.getTexture('splatColor'));
        c.setParameter('colorPalette', splat.colorPalette.texture);
        c.setParameter('count', splat.instances.count);
        c.setParameter('width', splat.resource.textureDimensions.x);
        c.setParameter('mode', ATTRIBUTE_MODES.indexOf(mode));
        c.setParameter('preview', preview);
        c.setParameter('previewAlpha', previewAlpha);
        c.setParameter('model', splat.entity.getWorldTransform().data);
        c.setParameter('view', view.data);
        const groups = Math.ceil(splat.instances.count / 256);
        c.setupDispatch(Math.min(groups, 65535), Math.ceil(groups / 65535));
        if (splat.instances.count > 0) this.device.computeDispatch([c], 'AttributeRange');
    }

    destroy() {
        this.compute.destroy(); this.shader.destroy(); this.format.destroy(); this.buffer.destroy();
    }
}

export { AttributeRange };
