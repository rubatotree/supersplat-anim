import { Button, Container, Label, NumericInput, SelectInput } from '@playcanvas/pcui';

import { sampleIndex } from '../animation/bgs-provider';
import { Events } from '../events';
import type { Splat } from '../splat';
import { i18n } from './localization';
import type { Tooltips } from './tooltips';

const nodeColor = (node: number): string => (node === 0 ? '#7a7a7a' : `hsl(${((node * 0.61803398875) % 1) * 360} 65% 60%)`);

class AnimationControls extends Container {
    constructor(events: Events, tooltips: Tooltips) {
        super({ id: 'animation-controls', hidden: true });
        const row = new Container({ class: 'animation-row' });
        const layer = new SelectInput({ id: 'animation-layer', options: [] });
        const clip = new SelectInput({ id: 'animation-clip', options: [] });
        const rate = new NumericInput({ id: 'animation-rate', value: 1, min: 0.01, max: 16, precision: 2 });
        const time = new NumericInput({ id: 'animation-time', value: 0, min: 0, precision: 3 });
        const bind = new Button({ id: 'animation-bind' });
        const colors = new Button({ id: 'animation-colors' });
        const samples = new Label({ id: 'animation-samples' });
        const inspector = new Label({ id: 'animation-inspector' });
        const legend = new Container({ id: 'animation-legend' });
        const axes = new Label({ id: 'animation-axes' });
        i18n.bindText(bind, 'animation.bind-pose');
        i18n.bindText(colors, 'animation.binding-colors');
        i18n.bindText(axes, 'animation.asset-axes');
        [layer, clip, new Label({ text: '×' }), rate, time, new Label({ text: 's' }), bind, colors, samples].forEach(element => row.append(element));
        this.append(row);
        this.append(inspector);
        this.append(legend);
        this.append(axes);
        let layers: Splat[] = [];
        let active: Splat | undefined;
        let updating = false;
        let selectedInstance = -1;
        const refreshTime = (): void => {
            if (!active?.animation?.frame) return;
            const animation = active.animation;
            const frame = animation.frame;
            const current = animation.provider.asset.clips.find(c => c.id === animation.clipId);
            updating = true;
            time.value = frame.time;
            updating = false;
            const index = sampleIndex(current.sampleTimes, frame.time);
            samples.text = frame.clipId === '__bind__' ? i18n.t('animation.bind-pose') :
                i18n.t('animation.sample', { sample: index, source: current.sourceFrames?.[index] ?? index });
            if (animation.fallbackCount) samples.text += ` · ${i18n.t('animation.fallbacks', { count: animation.fallbackCount })}`;
        };
        const refreshInspector = (): void => {
            if (!active?.animation) return;
            const { data } = active.animation.provider;
            if (selectedInstance < 0) {
                inspector.text = i18n.t('animation.inspect-one');
                return;
            }
            const row = active.animation.sourceRows[active.instances.sourceRow[selectedInstance]];
            const slots = Array.from({ length: 4 }, (_, slot) => {
                const index = row * 4 + slot;
                return `${data.scene.nodes[data.gaussians.bindNodes[index]].name}: ${data.gaussians.bindWeights[index].toFixed(4)}`;
            });
            inspector.text = `ID ${data.gaussians.sourceIds[row]} · ${slots.join(' · ')}`;
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
            layer.options = layers.map(splat => ({ v: String(splat.uid), t: splat.animation.provider.asset.name }));
            updating = false;
            chooseLayer();
        });
        events.on('animation.frame', (splat: Splat) => {
            if (splat === active) refreshTime();
        });
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
        colors.on('click', () => events.fire('animation.setBindingColors', !events.invoke('animation.bindingColors')));
        events.on('animation.bindingColors', (value: boolean) => colors.class.toggle('active', value));
        const names = ['layer', 'clip', 'rate', 'seconds', 'bind-pose', 'binding-colors'];
        [layer, clip, rate, time, bind, colors].forEach((element, index) => {
            tooltips.register(element, () => i18n.t(`animation.${names[index]}`), 'top');
            i18n.onChange(() => element.dom.setAttribute('aria-label', i18n.t(`animation.${names[index]}`)));
        });
        i18n.onChange(() => {
            refreshTime(); refreshInspector();
        });
    }
}

export { AnimationControls, nodeColor };
