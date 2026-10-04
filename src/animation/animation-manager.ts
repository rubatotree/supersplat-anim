import { MemoryReadFileSystem } from '@playcanvas/splat-transform';
import { Mat4, Quat } from 'playcanvas';

import { ElementType } from '../element';
import { PermutedChunkSource } from '../io';
import type { Scene } from '../scene';
import { Splat } from '../splat';
import { AnimatedGeometry } from './animated-geometry';
import { BgsProvider } from './bgs-provider';
import type { BgsData } from './bgs-types';

// Proper rotation: asset +X forward, +Y left, +Z up -> editor -Z forward, -X left, +Y up.
const assetToEditor = new Mat4().set([0, 0, -1, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]);

const registerAnimationEvents = (scene: Scene): void => {
    const { events } = scene;
    const layers = (): Splat[] => (scene.getElementsByType(ElementType.splat) as Splat[]).filter(splat => splat.animation);
    let bindingColors = false;
    events.function('animation.bindingColors', () => bindingColors);
    events.on('animation.setBindingColors', (value: boolean) => {
        bindingColors = !!value;
        scene.forceRender = true;
        layers().forEach(splat => splat.changedCounter++);
        events.fire('animation.bindingColors', bindingColors);
    });
    events.on('animation.error', (message: string) => events.invoke('showPopup', { type: 'error', header: 'Animation', message }));
    let pending: number | null = null;
    let draining = false;
    const prepare = async (time: number): Promise<void> => {
        for (const splat of layers()) await splat.animation.prepare(time);
    };
    const drain = async (): Promise<void> => {
        if (draining) return;
        draining = true;
        try {
            while (pending !== null) {
                const time = pending;
                pending = null;
                await events.invoke('queue', () => prepare(time));
            }
        } catch (error) {
            events.fire('timeline.setPlaying', false);
            events.fire('animation.error', error instanceof Error ? error.message : String(error));
        } finally {
            draining = false;
        }
    };
    events.on('timeline.seconds', (time: number) => {
        if (!layers().length) return;
        pending = time;
        layers().forEach(splat => splat.animation.invalidate());
        drain();
    });
    // Offline capture bypasses coalescing and waits for this exact time.
    events.function('animation.prepare', (time: number) => events.invoke('queue', () => prepare(time)));
    events.function('animation.layers', layers);
    events.function('animation.import', async (data: BgsData): Promise<Splat> => {
        const first = layers().length === 0;
        const fileSystem = new MemoryReadFileSystem();
        fileSystem.set('gaussians.ply', data.gaussians.bytes);
        const loaded = await scene.assetLoader.loadAsset('gaussians.ply', fileSystem);
        const splat = new Splat(loaded.asset, new Quat().setFromMat4(assetToEditor));
        const source = splat.resource.source;
        splat.animation = new AnimatedGeometry(splat, new BgsProvider(data), source instanceof PermutedChunkSource ? source.order : undefined);
        try {
            await scene.add(splat);
            await events.invoke('animation.prepare', events.invoke('timeline.seconds'));
        } catch (error) {
            splat.destroy();
            throw error;
        }
        const clip = splat.animation.provider.asset.clips[0];
        const lastCameraKey = Math.max(0, ...(events.invoke('track.keys') as number[] ?? []));
        const keyDuration = (lastCameraKey + 1) / events.invoke('timeline.frameRate');
        events.fire('timeline.setDuration', Math.max(clip.duration, keyDuration, first ? 0 : events.invoke('timeline.duration')));
        if (first) events.fire('timeline.setLoop', clip.loopDefault);
        events.fire('animation.layers', layers());
        events.fire('statusBar.setPanel', 'timeline');
        return splat;
    });
    events.on('scene.elementRemoved', (splat: Splat) => {
        splat.animation?.invalidate();
        events.fire('animation.layers', layers());
    });
    events.on('scene.clear', () => {
        pending = null;
    });
};

export { assetToEditor, registerAnimationEvents };
