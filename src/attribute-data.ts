import { type ChunkData, type ChunkLayer } from '@playcanvas/splat-transform';
import { PIXELFORMAT_RGBA32F, Texture } from 'playcanvas';

import { type AttributeRenderSettings, defaultAttributeSettings } from './attribute-render';
import type { EditorSplatResource } from './editor-splat-resource';

// 使用源数据的当前（含 Morton 重排）行顺序，而非导入文件的原始行号。
const readAttributeColumns = async (resource: EditorSplatResource, names: string[]): Promise<Float32Array> => {
    const source = resource.source;
    const descriptors = names.map((name) => {
        const aliases: Record<string, [ChunkLayer, string, number]> = {
            x: ['position', 'position', 0], y: ['position', 'position', 1], z: ['position', 'position', 2]
        };
        for (let i = 0; i < 4; i++) aliases[`rot_${i}`] = ['geometric', 'rotation', i];
        for (let i = 0; i < 3; i++) {
            aliases[`scale_${i}`] = ['geometric', 'scale', i];
            aliases[`f_dc_${i}`] = ['color', 'dc', i];
        }
        for (let i = 0; i < 45; i++) aliases[`f_rest_${i}`] = ['color', 'shRest', i];
        if (aliases[name]) {
            const [layer, fieldName, component] = aliases[name];
            const field = source.meta.layouts[layer]?.fields[fieldName];
            if (field && component < field.components) return { layer, field: { ...field, byteOffset: field.byteOffset + component * 4 } };
        }
        for (const [layer, layout] of Object.entries(source.meta.layouts)) {
            if (layout.fields[name]) return { layer: layer as ChunkLayer, field: layout.fields[name] };
        }
        throw new Error(`Unknown Gaussian property: ${name}`);
    });
    const result = new Float32Array(resource.numRows * 4);
    const layers = [...new Set(descriptors.map(d => d.layer))];
    for (let chunkIndex = 0; chunkIndex < source.meta.numChunks[0]; chunkIndex++) {
        const base = chunkIndex * source.meta.chunkSize;
        const count = Math.min(source.meta.chunkSize, resource.numRows - base);
        const chunks: Partial<Record<ChunkLayer, ChunkData>> = {};
        try {
            for (const layer of layers) chunks[layer] = resource.sourcePool.acquire(layer, source.meta.layouts[layer], count);
            await source.read({ chunkIndex, ...chunks });
            descriptors.forEach(({ layer, field }, channel) => {
                const chunk = chunks[layer];
                const view = new DataView(chunk.data);
                for (let i = 0; i < count; i++) {
                    const offset = i * chunk.stride + field.byteOffset;
                    result[(base + i) * 4 + channel] = field.type === 'uint32' ? view.getUint32(offset, true) : view.getFloat32(offset, true);
                }
            });
        } finally {
            Object.values(chunks).forEach(chunk => chunk.release());
        }
    }
    return result;
};

class AttributeData {
    texture: Texture;
    settings = defaultAttributeSettings();
    loading = false;
    private revision = 0;
    private key = '';
    private columnsKey = '[]';
    private pending: Promise<void>;
    private closed = false;

    constructor(readonly resource: EditorSplatResource) {
        this.texture = new Texture(resource.device, { name: 'empty-attributes', width: 1, height: 1, format: PIXELFORMAT_RGBA32F, mipmaps: false });
        (this.texture.lock() as Float32Array).fill(0);
        this.texture.unlock();
    }

    prepare(settings: AttributeRenderSettings): Promise<void> {
        const key = JSON.stringify(settings);
        if (this.key === key) return this.pending;
        this.key = key;
        const revision = ++this.revision;
        const columns = settings.mode === 'scalar' ? [settings.property] : settings.mode === 'rgb' ? settings.channels :
            settings.mode === 'normal' && ['nx', 'ny', 'nz'].every(n => this.resource.propertyNames.has(n)) ? ['nx', 'ny', 'nz'] : [];
        const columnsKey = JSON.stringify(columns);
        // 色标和范围调整只更新参数，避免反复读取/上传相同的静态列。
        if (!this.loading && this.columnsKey === columnsKey) {
            this.settings = { ...settings, channels: [...settings.channels] };
            this.pending = Promise.resolve();
            return this.pending;
        }
        this.loading = columns.length > 0;
        this.pending = (async () => {
            const values = columns.length ? await readAttributeColumns(this.resource, columns) : null;
            if (this.closed || revision !== this.revision) return;
            const texture = new Texture(this.resource.device, {
                name: 'gaussian-attributes',
                format: PIXELFORMAT_RGBA32F,
                mipmaps: false,
                width: values ? this.resource.textureDimensions.x : 1,
                height: values ? this.resource.textureDimensions.y : 1
            });
            const data = texture.lock() as Float32Array;
            data.fill(0);
            if (values) data.set(values);
            texture.unlock();
            texture.upload();
            // CPU 源仍由 ChunkSource 持有，上传后不保留第二份列副本。
            (texture as any)._levels[0] = null;
            this.texture.destroy();
            this.texture = texture;
            this.columnsKey = columnsKey;
            this.settings = { ...settings, channels: [...settings.channels] };
        })().finally(() => {
            if (revision === this.revision) this.loading = false;
        });
        return this.pending;
    }

    destroy() {
        this.closed = true;
        this.revision++;
        this.texture.destroy();
    }
}

export { AttributeData, readAttributeColumns };
