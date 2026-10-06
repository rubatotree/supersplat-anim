import {
    ADDRESS_CLAMP_TO_EDGE, BLENDEQUATION_ADD, BLENDMODE_ONE, BLENDMODE_ONE_MINUS_SRC_ALPHA, BlendState, BindGroupFormat, BindStorageTextureFormat, BindTextureFormat, BindUniformBufferFormat,
    Color, Compute, FILTER_NEAREST, Mat4, PIXELFORMAT_RGBA16F, PIXELFORMAT_RGBA32F, RenderPassPicker, RenderTarget, SAMPLETYPE_UNFILTERABLE_FLOAT,
    SHADERLANGUAGE_WGSL, SHADERSTAGE_COMPUTE, Shader, TEXTUREDIMENSION_2D_ARRAY, Texture,
    UNIFORMTYPE_MAT4, UNIFORMTYPE_UINT, UNIFORMTYPE_FLOAT, UniformBufferFormat, UniformFormat
} from 'playcanvas';

import type { Scene } from './scene';
import type { Splat } from './splat';

const pseudoNormalShader = /* wgsl */`
struct Uniforms { width: u32, height: u32, slot: u32, ortho: u32, depthScale: f32, inverseProjection: mat4x4f, cameraWorld: mat4x4f }
@group(0) @binding(0) var depthMap: texture_2d<f32>;
@group(0) @binding(1) var normals: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;
fn depthAt(p: vec2i) -> vec2f {
    if (any(p < vec2i(0)) || any(p >= vec2i(i32(uniforms.width),i32(uniforms.height)))) { return vec2f(0.0); }
    let v = textureLoad(depthMap,p,0);
    if (v.a < 1e-5) { return vec2f(0.0); }
    return vec2f(v.r / v.a * uniforms.depthScale,v.a);
}
fn positionAt(p: vec2i, depth: f32) -> vec3f {
    let ndc = (vec2f(p)+0.5) / vec2f(f32(uniforms.width),f32(uniforms.height)) * 2.0 - 1.0;
    let h = uniforms.inverseProjection * vec4f(ndc.x,-ndc.y,0.0,1.0);
    let point = h.xyz / h.w;
    if (uniforms.ortho != 0u) { return vec3f(point.xy,-depth); }
    return point * (depth / -point.z);
}
@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    if (gid.x >= uniforms.width || gid.y >= uniforms.height) { return; }
    let p = vec2i(gid.xy);
    let sample = depthAt(p);
    let d = sample.x;
    var color = vec4f(0.0);
    if (sample.y > 0.0) {
        color = vec4f(vec3f(0.5),1.0);
        let left = depthAt(p-vec2i(1,0)); let right = depthAt(p+vec2i(1,0));
        let top = depthAt(p-vec2i(0,1)); let bottom = depthAt(p+vec2i(0,1));
        let l = left.x; let r = right.x; let t = top.x; let b = bottom.x;
        if ((left.y > 0.0 || right.y > 0.0) && (top.y > 0.0 || bottom.y > 0.0)) {
            let useLeft = left.y > 0.0 && (right.y == 0.0 || abs(l-d) <= abs(r-d));
            let useTop = top.y > 0.0 && (bottom.y == 0.0 || abs(t-d) <= abs(b-d));
            let center = positionAt(p,d);
            let dx = select(positionAt(p+vec2i(1,0),r)-center,center-positionAt(p-vec2i(1,0),l),useLeft);
            let dy = select(positionAt(p+vec2i(0,1),b)-center,center-positionAt(p-vec2i(0,1),t),useTop);
            let raw = cross(dx,dy);
            if (dot(raw,raw) > 1e-20) {
                var normal = normalize(raw);
                let toCamera = select(-center,vec3f(0,0,1),uniforms.ortho != 0u);
                if (dot(normal,toCamera) < 0.0) { normal = -normal; }
                let world = normalize((uniforms.cameraWorld * vec4f(normal,0)).xyz);
                color = vec4f(world*0.5+0.5,1.0);
            }
        }
    }
    textureStore(normals,p,i32(uniforms.slot),color);
}`;

class PseudoNormals {
    texture: Texture;
    private depth: RenderTarget;
    private pass: RenderPassPicker;
    private compute: Compute;
    private shader: Shader;
    private format: BindGroupFormat;
    private inverseProjection = new Mat4();

    constructor(private scene: Scene) {
        const device = scene.graphicsDevice;
        this.texture = this.createNormals(1, 1, 1);
        this.pass = new RenderPassPicker(device, scene.app.renderer);
        const uniforms = new UniformBufferFormat(device, [
            ...['width', 'height', 'slot', 'ortho'].map(n => new UniformFormat(n, UNIFORMTYPE_UINT)),
            new UniformFormat('depthScale', UNIFORMTYPE_FLOAT),
            new UniformFormat('inverseProjection', UNIFORMTYPE_MAT4), new UniformFormat('cameraWorld', UNIFORMTYPE_MAT4)
        ]);
        this.format = new BindGroupFormat(device, [
            new BindTextureFormat('depthMap', SHADERSTAGE_COMPUTE, undefined, SAMPLETYPE_UNFILTERABLE_FLOAT, false),
            new BindStorageTextureFormat('normals', PIXELFORMAT_RGBA16F, TEXTUREDIMENSION_2D_ARRAY, true, false),
            new BindUniformBufferFormat('uniforms', SHADERSTAGE_COMPUTE)
        ]);
        this.shader = new Shader(device, { name: 'PseudoNormals',
            shaderLanguage: SHADERLANGUAGE_WGSL,
            cshader: pseudoNormalShader,
            computeBindGroupFormat: this.format,
            computeUniformBufferFormats: { uniforms } });
        this.compute = new Compute(device, this.shader, 'PseudoNormals');
    }

    private createNormals(width: number, height: number, count: number) {
        return new Texture(this.scene.graphicsDevice, { name: 'pseudo-normal-layers',
            width,
            height,
            arrayLength: count,
            format: PIXELFORMAT_RGBA16F,
            mipmaps: false,
            storage: true,
            minFilter: FILTER_NEAREST,
            magFilter: FILTER_NEAREST,
            addressU: ADDRESS_CLAMP_TO_EDGE,
            addressV: ADDRESS_CLAMP_TO_EDGE });
    }

    resize(width: number, height: number, count: number) {
        if (count === 0) {
            this.depth?.colorBuffer.destroy(); this.depth?.destroy(); this.depth = null;
            if (this.texture.width !== 1 || this.texture.height !== 1 || this.texture.arrayLength !== 1) {
                this.texture.destroy(); this.texture = this.createNormals(1, 1, 1);
            }
            return;
        }
        if (this.texture.width !== width || this.texture.height !== height || this.texture.arrayLength !== count) {
            this.texture.destroy(); this.texture = this.createNormals(width, height, count);
        }
        if (!this.depth) {
            this.depth = new RenderTarget({ colorBuffer: new Texture(this.scene.graphicsDevice, {
                name: 'pseudo-depth',
                width,
                height,
                format: this.scene.graphicsDevice.textureFloatBlendable ? PIXELFORMAT_RGBA32F : PIXELFORMAT_RGBA16F,
                mipmaps: false,
                minFilter: FILTER_NEAREST,
                magFilter: FILTER_NEAREST
            }),
            depth: false });
        } else if (this.depth.width !== width || this.depth.height !== height) {
            this.depth.resize(width, height);
        }
    }

    render(splat: Splat, slot: number) {
        const scene = this.scene;
        const renderer = scene.projectedSplatRenderer;
        const material = renderer.material;
        renderer.preparePick(splat, 3, true);
        material.setParameter('pickMode', 2);
        // 用相机 far 归一化以避免半精度深度溢出；微分前还原线性深度。
        const depthScale = Math.max(1, Math.abs(scene.camera.camera.farClip));
        material.setParameter('pseudoDepthScale', depthScale);
        this.pass.blendState = new BlendState(true, BLENDEQUATION_ADD, BLENDMODE_ONE, BLENDMODE_ONE_MINUS_SRC_ALPHA);
        this.pass.init(this.depth);
        this.pass.setClearColor(new Color(0, 0, 0, 0));
        this.pass.update(scene.camera.camera, scene.app.scene, [scene.splatLayer], new Map(), false);
        try {
            this.pass.render();
        } finally {
            renderer.finishPick();
        }
        const c = this.compute;
        c.setParameter('depthMap', this.depth.colorBuffer);
        c.setParameter('normals', this.texture);
        c.setParameter('width', this.depth.width); c.setParameter('height', this.depth.height);
        c.setParameter('slot', slot - 1);
        c.setParameter('ortho', scene.camera.camera.projection === 1 ? 1 : 0);
        c.setParameter('depthScale', depthScale);
        c.setParameter('inverseProjection', this.inverseProjection.invert(scene.camera.camera.projectionMatrix).data);
        c.setParameter('cameraWorld', scene.camera.mainCamera.getWorldTransform().data);
        c.setupDispatch(Math.ceil(this.depth.width / 8), Math.ceil(this.depth.height / 8));
        scene.graphicsDevice.computeDispatch([c], 'PseudoNormals');
    }

    destroy() {
        this.texture.destroy(); this.depth?.colorBuffer.destroy(); this.depth?.destroy(); this.pass.destroy();
        this.compute.destroy(); this.shader.destroy(); this.format.destroy();
    }

    get gpuBytes() {
        return this.texture.gpuSize + (this.depth?.colorBuffer.gpuSize ?? 0);
    }
}

export { PseudoNormals, pseudoNormalShader };
