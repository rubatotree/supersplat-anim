import { BooleanInput, Container, Label, NumericInput, SelectInput } from '@playcanvas/pcui';

import { COLORMAPS, AttributeSettingsOp, normalizeAttributeSettings, rgbPropertyGroups, scalarAttributeMode, type AttributeRenderSettings } from '../attribute-render';
import type { Events } from '../events';
import { COLORMAP_STOPS } from '../shaders/attribute-chunk';
import type { Splat } from '../splat';
import { i18n } from './localization';

class AttributePanel extends Container {
    constructor(events: Events) {
        super({ class: 'attribute-panel' });
        let selected: Splat = null;
        let suppress = false;
        const row = (key: string, control: Container | SelectInput | NumericInput | BooleanInput) => {
            const container = new Container({ class: 'color-panel-row' });
            const label = new Label({ class: 'color-panel-row-label' });
            i18n.bindText(label, `panel.attributes.${key}`);
            control.class.add('attribute-control');
            container.append(label); container.append(control); this.append(container);
            return container;
        };
        const mode = new SelectInput({ class: 'attribute-mode', options: [] });
        row('render', mode);
        const colormap = new SelectInput({ options: [] });
        const colormapRow = row('colormap', colormap);
        i18n.bindOptions(colormap, () => COLORMAPS.map(v => ({ v, t: v === 'gray' ? i18n.t('panel.attributes.gray') : v[0].toUpperCase() + v.slice(1) })));
        const automatic = new BooleanInput({ value: true });
        const automaticRow = row('auto-range', automatic);
        const minimum = new NumericInput({ value: 0, precision: 6 });
        const maximum = new NumericInput({ value: 1, precision: 6 });
        const minimumRow = row('min', minimum);
        const maximumRow = row('max', maximum);
        const legend = new Container({ class: 'attribute-legend' });
        this.append(legend);
        const channels = [new SelectInput({ options: [] }), new SelectInput({ options: [] }), new SelectInput({ options: [] })];
        const channelRows = channels.map((control, i) => row(['red', 'green', 'blue'][i], control));
        const status = new Label({ class: 'attribute-status', hidden: true });
        i18n.bindText(status, 'panel.attributes.loading');
        this.append(status);

        const properties = () => (selected ? [...selected.resource.propertyNames].filter(p => p !== 'state' && p !== 'transform') : []);
        const options = () => {
            const builtins = ['color', 'depth', 'normal', 'pseudo-normal', ...(selected?.animation ? ['binding'] : []), 'opacity', 'rgb'];
            return [
                ...builtins.map(v => ({ v, t: i18n.t(`panel.attributes.${v}`) })),
                ...rgbPropertyGroups(properties()).map(g => ({ v: `rgb:${g.channels.join(',')}`, t: `${g.name} (RGB)` })),
                ...properties().filter(p => p !== 'opacity').map(p => ({ v: `scalar:${p}`, t: p }))
            ];
        };

        const refresh = () => {
            suppress = true;
            this.enabled = !!selected;
            const settings = selected?.attributeSettings ?? normalizeAttributeSettings();
            mode.options = options();
            mode.value = settings.mode === 'scalar' ? `scalar:${settings.property}` : settings.mode;
            colormap.value = settings.colormap;
            automatic.value = settings.autoRange;
            minimum.value = settings.min; maximum.value = settings.max;
            const scalar = scalarAttributeMode(settings.mode);
            for (const r of [colormapRow, automaticRow, minimumRow, maximumRow, legend]) r.hidden = !scalar;
            minimum.enabled = maximum.enabled = !settings.autoRange;
            channelRows.forEach((r, i) => {
                r.hidden = settings.mode !== 'rgb';
                channels[i].options = properties().map(v => ({ v, t: v }));
                channels[i].value = settings.channels[i];
            });
            const index = COLORMAPS.indexOf(settings.colormap);
            const colors = index === 3 ? [[0, 0, 0], [1, 1, 1]] : COLORMAP_STOPS[index];
            legend.dom.style.background = `linear-gradient(to right, ${colors.map(c => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`).join(',')})`;
            suppress = false;
        };
        const update = (changes: Partial<AttributeRenderSettings>) => {
            if (suppress || !selected) return;
            const next = normalizeAttributeSettings({ ...selected.attributeSettings, ...changes });
            if (JSON.stringify(next) === JSON.stringify(selected.attributeSettings)) return;
            const op = new AttributeSettingsOp(selected, next);
            op.do();
            events.fire('edit.add', op, true);
            refresh();
        };
        mode.on('change', (value: string) => {
            if (!value || suppress) return;
            if (value.startsWith('scalar:')) update({ mode: 'scalar', property: value.slice(7) });
            else if (value.startsWith('rgb:')) update({ mode: 'rgb', channels: value.slice(4).split(',') as [string, string, string] });
            else update({ mode: value as AttributeRenderSettings['mode'] });
        });
        colormap.on('change', (value: AttributeRenderSettings['colormap']) => update({ colormap: value }));
        automatic.on('change', (value: boolean) => update({ autoRange: value }));
        const rangeChanged = () => {
            if (!Number.isFinite(minimum.value) || !Number.isFinite(maximum.value) || minimum.value >= maximum.value) return;
            update({ min: minimum.value, max: maximum.value });
        };
        minimum.on('change', rangeChanged); maximum.on('change', rangeChanged);
        channels.forEach((control, index) => control.on('change', (value: string) => {
            if (!selected || suppress || !value) return;
            const next = [...selected.attributeSettings.channels] as [string, string, string];
            next[index] = value; update({ channels: next });
        }));
        events.on('selection.changed', (splat: Splat) => {
            selected = splat; status.hidden = true; refresh();
        });
        events.on('splat.attributeChanged', (splat: Splat) => {
            if (selected === splat) {
                status.hidden = true; refresh();
            }
        });
        events.on('splat.attributeLoading', (splat: Splat) => {
            if (selected === splat) {
                status.hidden = false;
            }
        });
        i18n.onChange(refresh, this);
    }
}

export { AttributePanel };
