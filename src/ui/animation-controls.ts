import { Button, Container, Element, Label, NumericInput, SelectInput } from '@playcanvas/pcui';

import { sampleIndex } from '../animation/bgs-provider';
import { Events } from '../events';
import type { Splat } from '../splat';
import { i18n } from './localization';
import bindingIcon from './svg/orient.svg';
import type { Tooltips } from './tooltips';

const nodeColor = (node: number): string => {
    if (node === 0) return '#7a7a7a';
    const hue = (node * 0.61803398875) % 1;
    const rgb = [0, 2 / 3, 1 / 3].map((offset) => {
        const channel = Math.max(0, Math.min(1, Math.abs(((hue + offset) % 1) * 6 - 3) - 1));
        return Math.round((0.35 + 0.65 * channel) * 0.9 * 255);
    });
    return `rgb(${rgb.join(' ')})`;
};

class AnimationControls extends Container {
    constructor(events: Events, tooltips: Tooltips) {
        super({ id: 'animation-controls', hidden: true });
        const header = new Container({ class: 'animation-header' });
        const title = new Label({ class: 'animation-title' });
        const status = new Label({ id: 'animation-status' });
        const row = new Container({ class: 'animation-row' });
        const layer = new SelectInput({ id: 'animation-layer', options: [] });
        const clip = new SelectInput({ id: 'animation-clip', options: [] });
        const rate = new NumericInput({ id: 'animation-rate', value: 1, min: 0.01, max: 16, precision: 2 });
        const time = new NumericInput({ id: 'animation-time', value: 0, min: 0, precision: 3 });
        const bind = new Button({ id: 'animation-bind' });
        const samples = new Label({ id: 'animation-samples' });
        const inspector = new Label({ id: 'animation-inspector' });
        const legend = new Container({ id: 'animation-legend' });
        const axes = new Label({ id: 'animation-axes' });
        const duration = new Label({ id: 'animation-duration' });
        const details = new Container({ id: 'animation-details', hidden: true });
        i18n.bindText(title, 'animation.title');
        i18n.bindText(bind, 'animation.bind-pose');
        i18n.bindText(axes, 'animation.asset-axes');
        header.append(title);
        header.append(status);
        header.append(samples);
        const field = (control: Element, key: string, className: string): Container => {
            const group = new Container({ class: ['animation-field', className] });
            const label = new Label({ class: 'animation-field-label' });
            i18n.bindText(label, key);
            group.append(label);
            group.append(control);
            return group;
        };
        const timeField = field(time, 'animation.seconds', 'animation-time-field');
        timeField.append(duration);
        const actions = new Container({ class: 'animation-actions' });
        for (const [button, icon] of [[bind, bindingIcon]] as const) {
            const svg = new DOMParser().parseFromString(decodeURIComponent(icon.slice('data:image/svg+xml,'.length)), 'image/svg+xml').documentElement;
            button.dom.prepend(svg);
            i18n.onChange(() => button.dom.prepend(svg), button);
            actions.append(button);
        }
        row.append(field(layer, 'animation.layer', 'animation-layer-field'));
        row.append(field(clip, 'animation.clip', 'animation-clip-field'));
        row.append(timeField);
        row.append(field(rate, 'animation.rate', 'animation-rate-field'));
        row.append(actions);
        details.append(inspector);
        details.append(legend);
        details.append(axes);
        this.append(header);
        this.append(row);
        this.append(details);
        // collapsible body; the user's choice persists across sessions
        const collapseKey = 'supersplat:animationPanelCollapsed';
        // collapsed by default; an explicit expand choice persists
        let collapsed = true;
        try {
            collapsed = localStorage.getItem(collapseKey) !== '0';
        } catch { /* localStorage unavailable */ }
        const refreshBody = (): void => {
            header.hidden = collapsed;
            row.hidden = collapsed;
            details.hidden = collapsed;
            this.class.toggle('collapsed', collapsed);
        };
        refreshBody();
        events.function('animation.panelCollapsed', () => collapsed);
        events.on('animation.setPanelCollapsed', (value: boolean) => {
            if (collapsed === value) return;
            collapsed = value;
            try {
                localStorage.setItem(collapseKey, collapsed ? '1' : '0');
            } catch { /* localStorage unavailable */ }
            refreshBody();
            events.fire('animation.panelCollapsed', collapsed);
        });
        let layers: Splat[] = [];
        let active: Splat | undefined;
        let updating = false;
        let selectedInstance = -1;
        const refreshStatus = (): void => {
            const state = active?.animation?.bindPose ? 'bind-pose' : events.invoke('timeline.playing') ? 'playing' : 'paused';
            status.text = i18n.t(`animation.${state}`);
            status.class.toggle('playing', state === 'playing');
            bind.dom.setAttribute('aria-pressed', String(!!active?.animation?.bindPose));
        };
        const refreshTime = (): void => {
            if (!active?.animation?.frame) return;
            const animation = active.animation;
            const frame = animation.frame;
            const current = animation.provider.asset.clips.find(c => c.id === animation.clipId);
            if (!current) return;
            updating = true;
            time.value = frame.time;
            duration.text = `/ ${current.duration.toFixed(3)} s`;
            updating = false;
            const index = sampleIndex(current.sampleTimes, frame.time);
            samples.text = frame.clipId === '__bind__' ? i18n.t('animation.bind-pose') :
                i18n.t('animation.sample', { sample: index, source: current.sourceFrames?.[index] ?? index });
            if (animation.fallbackCount) samples.text += ` · ${i18n.t('animation.fallbacks', { count: animation.fallbackCount })}`;
            refreshStatus();
        };
        const refreshInspector = (): void => {
            if (!active?.animation) return;
            const { data } = active.animation.provider;
            if (selectedInstance < 0) {
                inspector.text = i18n.t('animation.inspect-one');
                return;
            }
            const row = active.animation.sourceRows[active.instances.sourceRow[selectedInstance]];
            const g = data.gaussians;
            const bytes = new DataView(g.bytes.buffer, g.bytes.byteOffset, g.bytes.byteLength);
            const offset = g.headerBytes + row * g.stride;
            inspector.text = '';
            inspector.dom.replaceChildren();
            const identity = document.createElement('div');
            identity.className = 'animation-gaussian-id';
            identity.textContent = `ID ${g.sourceIds[row]}`;
            const slots = document.createElement('div');
            slots.className = 'animation-binding-slots';
            for (let slot = 0; slot < 4; slot++) {
                // Evaluation merges duplicate influences; inspection shows the
                // actual four authored slots retained in the source PLY.
                const node = bytes.getUint32(offset + g.properties.find(p => p.name === `bind_node_${slot}`).offset, true);
                const weight = bytes.getFloat32(offset + g.properties.find(p => p.name === `bind_weight_${slot}`).offset, true);
                const item = document.createElement('div');
                item.className = 'animation-binding-slot';
                const label = document.createElement('span');
                label.textContent = `${data.scene.nodes[node].name}: ${weight.toFixed(4)}`;
                label.title = `${slot + 1} · ${data.scene.nodes[node].name} · ${weight}`;
                const track = document.createElement('div');
                track.className = 'animation-weight-track';
                const fill = document.createElement('i');
                fill.style.width = `${weight * 100}%`;
                fill.style.backgroundColor = nodeColor(node);
                track.append(fill);
                item.append(label, track);
                slots.append(item);
            }
            inspector.dom.append(identity, slots);
        };
        const refreshSelection = (): void => {
            selectedInstance = -1;
            if (active?.instances.numSelected === 1) {
                selectedInstance = active.instances.flags.subarray(0, active.instances.count).findIndex(flag => flag === 1);
            }
            refreshInspector();
        };
        const chooseLayer = (): void => {
            active = layers.find(splat => String(splat.uid) === layer.value) ?? layers[0];
            if (!active?.animation) return;
            updating = true;
            layer.value = String(active.uid);
            clip.options = active.animation.provider.asset.clips.map(c => ({ v: c.id, t: c.id }));
            clip.value = active.animation.clipId;
            updating = false;
            bind.class.toggle('active', active.animation.bindPose);
            legend.dom.replaceChildren();
            for (const node of active.animation.provider.data.scene.nodes) {
                const item = document.createElement('span');
                const swatch = document.createElement('i');
                swatch.style.backgroundColor = nodeColor(node.index);
                item.append(swatch, document.createTextNode(node.name));
                legend.dom.append(item);
            }
            refreshSelection();
            refreshTime();
        };
        events.on('animation.layers', (value: Splat[]) => {
            layers = value;
            this.hidden = !layers.length;
            updating = true;
            layer.options = layers.map(splat => ({ v: String(splat.uid), t: splat.name }));
            updating = false;
            chooseLayer();
        });
        events.on('animation.frame', (splat: Splat) => {
            if (splat === active) refreshTime();
        });
        events.on('timeline.playing', refreshStatus);
        events.on('splat.stateChanged', (splat: Splat) => {
            if (splat === active) refreshSelection();
        });
        events.on('selection.changed', (splat: Splat) => {
            if (splat?.animation && layers.includes(splat)) {
                updating = true;
                layer.value = String(splat.uid);
                updating = false;
                chooseLayer();
            }
        });
        layer.on('change', () => {
            if (!updating) chooseLayer();
        });
        clip.on('change', () => {
            if (updating || !active?.animation) return;
            events.fire('timeline.setPlaying', false);
            active.animation.clipId = clip.value;
            const selected = active.animation.provider.asset.clips.find(c => c.id === clip.value);
            events.fire('timeline.setDuration', Math.max(events.invoke('timeline.duration'), selected.duration));
            events.fire('timeline.setSeconds', 0);
        });
        rate.on('change', (value: number) => {
            if (!updating) events.fire('timeline.setPlaybackRate', value);
        });
        time.on('change', (value: number) => {
            if (updating) return;
            events.fire('timeline.setPlaying', false);
            events.fire('timeline.setSeconds', value);
        });
        events.on('timeline.playbackRate', (value: number) => {
            updating = true;
            rate.value = value;
            updating = false;
        });
        bind.on('click', () => {
            if (!active?.animation) return;
            events.fire('timeline.setPlaying', false);
            active.animation.bindPose = !active.animation.bindPose;
            bind.class.toggle('active', active.animation.bindPose);
            events.fire('timeline.setSeconds', events.invoke('timeline.seconds'));
        });
        events.on('animation.capture', (active: boolean) => {
            this.enabled = !active;
        });
        const names = ['layer', 'clip', 'rate', 'seconds', 'bind-pose'];
        [layer, clip, rate, time, bind].forEach((element, index) => {
            tooltips.register(element, () => i18n.t(`animation.${names[index]}`), 'top');
            i18n.onChange(() => {
                const label = i18n.t(`animation.${names[index]}`);
                element.dom.setAttribute('aria-label', label);
                element.dom.querySelector('input')?.setAttribute('aria-label', label);
            });
        });
        i18n.onChange(() => {
            refreshTime(); refreshInspector(); refreshStatus();
        });
    }
}

export { AnimationControls, nodeColor };
