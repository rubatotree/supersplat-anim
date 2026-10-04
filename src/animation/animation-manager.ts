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
    scene.canvas.parentElement.addEventListener('pointerdown', () => {
        if (events.invoke('tool.active')) events.fire('animation.freeze');
    }, true);
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
    let captureDepth = 0;
    events.function('animation.capturing', () => captureDepth > 0);
    let generation = 0;
    let revision = 0;
    events.on('animation.captureBegin', () => {
        events.fire('animation.freeze');
        captureDepth++;
        events.fire('animation.capture', true);
    });
    events.on('animation.captureEnd', () => {
        captureDepth = Math.max(0, captureDepth - 1);
        events.fire('animation.capture', captureDepth > 0);
    });
    events.on('timeline.playing', (playing: boolean) => {
        if (captureDepth && playing) events.fire('timeline.setPlaying', false);
    });
    const prepare = async (time: number, requestedRevision?: number): Promise<void> => {
        const commits: (() => void)[] = [];
        const targets = layers();
        for (const splat of targets) {
            if (requestedRevision !== undefined && requestedRevision !== revision) return;
            commits.push(await splat.animation.stage(time));
        }
        if (requestedRevision !== undefined && requestedRevision !== revision) return;
        // One microtask publishes every layer's matching pose and bounds.
        commits.forEach(commit => commit());
        targets.filter(splat => splat.scene === scene).forEach(splat => events.fire('animation.frame', splat));
    };
    const preparePending = async (): Promise<void> => {
        const time = pending;
        pending = null;
        if (time !== null) await prepare(time, revision);
    };
    const drain = async (): Promise<void> => {
        if (draining) return;
        draining = true;
        try {
            while (true) {
                if (pending === null) break;
                await events.invoke('queue', preparePending);
            }
        } catch (error) {
            events.fire('timeline.setPlaying', false);
            events.fire('animation.error', error instanceof Error ? error.message : String(error));
        } finally {
            draining = false;
        }
    };
    events.on('timeline.seconds', (time: number, playbackTick: boolean) => {
        if (captureDepth || !layers().length) return;
        // A clock tick coalesces pending work without starving a valid in-flight
        // GPU reduction. Explicit seeks cancel old work before it can publish.
        if (!playbackTick) {
            revision++;
            layers().forEach(splat => splat.animation.invalidate());
        }
        pending = time;
        drain();
    });
    // Offline capture bypasses coalescing and waits for this exact time.
    events.function('animation.prepare', (time: number) => events.invoke('queue', () => prepare(time)));
    events.function('animation.layers', layers);
    events.function('animation.import', async (data: BgsData): Promise<Splat> => {
        const loadGeneration = generation;
        const first = layers().length === 0;
        const fileSystem = new MemoryReadFileSystem();
        fileSystem.set('gaussians.ply', data.gaussians.bytes);
        const loaded = await scene.assetLoader.loadAsset('gaussians.ply', fileSystem);
        const splat = new Splat(loaded.asset, new Quat().setFromMat4(assetToEditor));
        if (loadGeneration !== generation) {
            splat.destroy();
            throw new DOMException('Animation import cancelled by scene clear', 'AbortError');
        }
        const source = splat.resource.source;
        splat.animation = new AnimatedGeometry(splat, new BgsProvider(data), source instanceof PermutedChunkSource ? source.order : undefined);
        try {
            await events.invoke('queue', () => scene.add(splat));
            if (loadGeneration !== generation) throw new DOMException('Animation import cancelled by scene clear', 'AbortError');
            splat.name = data.scene.asset.name;
            await events.invoke('animation.prepare', events.invoke('timeline.seconds'));
        } catch (error) {
            splat.destroy();
            throw error;
        }
        const clip = splat.animation.provider.asset.clips[0];
        const lastCameraKey = Math.max(0, ...(events.invoke('track.keys') as number[] ?? []),
            ...(events.invoke('camera.poses') as { frame: number }[] ?? []).map(pose => pose.frame));
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
    events.on('scene.elementAdded', () => events.fire('animation.layers', layers()));
    events.on('animation.freeze', () => {
        if (captureDepth) return;
        revision++;
        events.fire('timeline.setPlaying', false);
        pending = null;
        layers().forEach(splat => splat.animation.invalidate());
    });
    for (const event of ['pivot.started', 'edit.undo', 'edit.redo', 'edit.duplicate', 'edit.separate',
        'select.all', 'select.none', 'select.invert', 'select.delete', 'select.byRect', 'select.byMask',
        'select.bySphere', 'select.byBox', 'select.mask', 'select.hide', 'select.unhide', 'scene.reset', 'edit.applyColor', 'edit.resetColor']) {
        events.on(event, () => events.fire('animation.freeze'));
    }
    events.on('scene.clear', () => {
        generation++;
        pending = null;
    });
};

export { assetToEditor, registerAnimationEvents };
