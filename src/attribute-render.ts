import type { Splat } from './splat';

type AttributeMode = 'color' | 'depth' | 'normal' | 'pseudo-normal' | 'binding' | 'opacity' | 'scalar' | 'rgb';
type Colormap = 'viridis' | 'turbo' | 'inferno' | 'gray';
type AttributeRenderSettings = {
    mode: AttributeMode;
    property: string;
    channels: [string, string, string];
    colormap: Colormap;
    autoRange: boolean;
    min: number;
    max: number;
};

// 数组顺序即 WGSL 的模式编号，修改时须同步更新属性着色分支。
const ATTRIBUTE_MODES: AttributeMode[] = ['color', 'depth', 'normal', 'binding', 'opacity', 'scalar', 'rgb', 'pseudo-normal'];
const COLORMAPS: Colormap[] = ['viridis', 'turbo', 'inferno', 'gray'];
const defaultAttributeSettings = (): AttributeRenderSettings => ({
    mode: 'color',
    property: 'scale_0',
    channels: ['f_dc_0', 'f_dc_1', 'f_dc_2'],
    colormap: 'viridis',
    autoRange: true,
    min: 0,
    max: 1
});

// 文档字段按白名单恢复，旧文档和损坏配置回退到中性的默认视图。
const normalizeAttributeSettings = (value: Partial<AttributeRenderSettings> = {}): AttributeRenderSettings => {
    const defaults = defaultAttributeSettings();
    return {
        mode: ATTRIBUTE_MODES.includes(value.mode) ? value.mode : defaults.mode,
        property: typeof value.property === 'string' ? value.property : defaults.property,
        channels: Array.isArray(value.channels) && value.channels.length === 3 && value.channels.every(c => typeof c === 'string') ?
            [...value.channels] as [string, string, string] : defaults.channels,
        colormap: COLORMAPS.includes(value.colormap) ? value.colormap : defaults.colormap,
        autoRange: value.autoRange !== false,
        min: Number.isFinite(value.min) && Number.isFinite(value.max) && value.min < value.max ? value.min : 0,
        max: Number.isFinite(value.min) && Number.isFinite(value.max) && value.min < value.max ? value.max : 1
    };
};

const rgbPropertyGroups = (names: Iterable<string>): { name: string, channels: [string, string, string] }[] => {
    const set = new Set(names);
    const groups: { name: string, channels: [string, string, string] }[] = [];
    for (const first of set) {
        for (const suffixes of [['x', 'y', 'z'], ['r', 'g', 'b'], ['0', '1', '2']]) {
            if (!first.endsWith(`_${suffixes[0]}`)) continue;
            const prefix = first.slice(0, -2);
            const channels = suffixes.map(s => `${prefix}_${s}`) as [string, string, string];
            if (channels.every(c => set.has(c))) groups.push({ name: prefix, channels });
        }
    }
    return groups;
};

const scalarAttributeMode = (mode: AttributeMode) => mode === 'depth' || mode === 'opacity' || mode === 'scalar';

class AttributeSettingsOp {
    readonly name = 'attributeSettings';
    private previous: AttributeRenderSettings;
    private next: AttributeRenderSettings;
    constructor(readonly splat: Splat, next: AttributeRenderSettings) {
        this.previous = normalizeAttributeSettings(splat.attributeSettings);
        this.next = normalizeAttributeSettings(next);
    }
    private apply(settings: AttributeRenderSettings) {
        this.splat.attributeSettings = normalizeAttributeSettings(settings);
        this.splat.changedCounter++;
        this.splat.scene.forceRender = true;
        this.splat.scene.events.fire('splat.attributeChanged', this.splat);
    }
    do() {
        this.apply(this.next);
    }
    undo() {
        this.apply(this.previous);
    }
}

export { ATTRIBUTE_MODES, COLORMAPS, AttributeSettingsOp, defaultAttributeSettings, normalizeAttributeSettings, rgbPropertyGroups, scalarAttributeMode };
export type { AttributeRenderSettings, AttributeMode, Colormap };
