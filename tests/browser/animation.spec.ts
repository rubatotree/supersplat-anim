import { expect, test } from '@playwright/test';

import { gaussianCovariance, transformCovariance } from '../../src/animation/math';

test('shared GPU pose agrees with CPU and survives rendering and picking', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error(message.text()); } });
    await page.goto('/?load=/fixtures/conformance/scene.json');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.animation?.frame));
    const results = await page.evaluate(async () => {
        const scene = (window as any).scene;
        const splat = scene.elements.find((s: any) => s.animation);
        const animation = splat.animation;
        let maxError = 0;
        for (const time of [0, 0.04, 0.1]) {
            await scene.events.invoke('animation.prepare', time);
            const pixels = await animation.poseTexture.read(0, 0, animation.poseTexture.width, animation.poseTexture.height, { data: new Float32Array(animation.poseTexture.width * animation.poseTexture.height * 4), immediate: true });
            for (let i = 0; i < splat.instances.count; i++) {
                const matrix = new Float64Array(16);
                animation.frame.readDeformation(animation.sourceRows[splat.instances.sourceRow[i]], matrix);
                for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
                    maxError = Math.max(maxError, Math.abs(pixels[i * 16 + row * 4 + col] - matrix[col * 4 + row]));
                }
            }
        }
        const histogram = await scene.dataProcessor.calcHistogram(splat, 0, { entityMatrix: splat.entity.getWorldTransform() });
        const mask = await scene.dataProcessor.intersect({ rect: { x1: 0, y1: 0, x2: 1, y2: 1 } }, splat);
        const picked = mask.length;
        scene.dataProcessor.releaseMask(mask);
        return { maxError, count: splat.instances.count, bound: [splat.localBound.center.x, splat.localBound.center.y, splat.localBound.center.z], histogram: !!histogram, picked };
    });
    console.log({ results, errors });
    expect(results.count).toBe(5);
    expect(results.maxError).toBeLessThan(1e-5);
    expect(results.histogram).toBeTruthy();
    expect(results.picked).toBeGreaterThanOrEqual(5);
    expect(results.bound.every(Number.isFinite)).toBeTruthy();
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
});

test('real 350k BGS loads and evaluates both experimental clips on WebGPU', async ({ page }) => {
    test.skip(process.env.BGS_SKIP_REAL === '1', 'Real sample explicitly disabled');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error(message.text()); } });
    await page.goto('/?load=/fixtures/real/scene.json');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.animation?.frame));
    const result = await page.evaluate(async () => {
        const scene = (window as any).scene;
        const splat = scene.elements.find((s: any) => s.animation);
        let maxError = 0;
        const animation = splat.animation;
        for (const clip of animation.provider.asset.clips) {
            animation.clipId = clip.id;
            await scene.events.invoke('animation.prepare', clip.duration * 0.6);
            const texture = animation.poseTexture;
            const pixels = await texture.read(0, 0, texture.width, texture.height, { data: new Float32Array(texture.width * texture.height * 4), immediate: true });
            for (let i = 0; i < splat.instances.count; i += 997) {
                const matrix = new Float64Array(16);
                animation.frame.readDeformation(animation.sourceRows[splat.instances.sourceRow[i]], matrix);
                for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) maxError = Math.max(maxError,
                    Math.abs(pixels[i * 16 + row * 4 + col] - matrix[col * 4 + row]));
            }
        }
        return { count: splat.instances.count, maxError, clips: animation.provider.asset.clips.length, gpu: scene.app.graphicsDevice.gpuAdapter.info.description };
    });
    console.log('real BGS GPU result', result);
    expect(result.count).toBe(350000);
    expect(result.clips).toBe(2);
    expect(result.maxError).toBeLessThan(1e-5);
    await page.screenshot({ path: 'test-results/real-bgs.png' });
    expect(errors).toEqual([]);
});

test('static PLY remains renderable through the shared shader path', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error(message.text()); } });
    await page.goto('/?load=/fixtures/conformance/gaussians.ply');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.instances?.count === 5));
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
});

test('animation controls expose bind pose, colors, source frames and narrow layout', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error(message.text()); } });
    await page.goto('/?load=/fixtures/conformance/scene.json');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.animation?.frame));
    await expect(page.locator('#animation-controls')).toBeVisible();
    await expect(page.locator('#animation-details')).toBeHidden();
    await page.locator('#animation-details-toggle').press('Enter');
    await expect(page.locator('#animation-details-toggle')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#animation-bind').click();
    await expect(page.locator('#animation-samples')).toHaveText('Bind pose');
    await page.locator('#animation-colors').click();
    await expect(page.locator('#animation-colors')).toHaveClass(/active/);
    await expect(page.locator('#animation-colors')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#animation-bind').click();
    await expect(page.locator('#animation-samples')).toContainText('Sample');
    const inspector = await page.evaluate(async () => {
        const scene = (window as any).scene;
        const splat = scene.events.invoke('animation.layers')[0];
        const mask = new Uint8Array(splat.instances.count); mask[0] = 255;
        scene.events.fire('select.mask', 'set', mask);
        await scene.events.invoke('queue', () => {});
        const g = splat.animation.provider.data.gaussians;
        const row = splat.animation.sourceRows[splat.instances.sourceRow[0]];
        const view = new DataView(g.bytes.buffer, g.bytes.byteOffset, g.bytes.byteLength);
        return Array.from({ length: 4 }, (_, k) => {
            const offset = g.headerBytes + row * g.stride;
            const node = view.getUint32(offset + g.properties.find((p: any) => p.name === `bind_node_${k}`).offset, true);
            const weight = view.getFloat32(offset + g.properties.find((p: any) => p.name === `bind_weight_${k}`).offset, true);
            return `${splat.animation.provider.data.scene.nodes[node].name}: ${weight.toFixed(4)}`;
        }).join(' · ');
    });
    for (const slot of inspector.split(' · ')) await expect(page.locator('#animation-inspector')).toContainText(slot);
    await page.setViewportSize({ width: 640, height: 720 });
    await page.screenshot({ path: 'test-results/animation-controls-narrow.png' });
    expect(await page.locator('#animation-controls').evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
    await page.locator('#animation-details-toggle').click();
    await page.setViewportSize({ width: 390, height: 720 });
    expect(await page.locator('#animation-controls').evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
    await page.screenshot({ path: 'test-results/animation-controls-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => {
        const language = Array.from(document.querySelectorAll('.pcui-select-input')).find((el: any) =>
            el.ui?.options?.some((option: any) => option.v === 'zh-CN')) as any;
        language.ui.value = 'zh-CN';
        (window as any).scene.events.fire('select.none');
    });
    await expect(page.locator('#animation-details-toggle')).toHaveText('绑定详情');
    await page.locator('#animation-details-toggle').click();
    await expect(page.locator('#animation-inspector')).toContainText('选择单个高斯');
    expect(await page.locator('#animation-bind svg').count()).toBe(1);
    expect(await page.locator('#animation-colors svg').count()).toBe(1);
    await page.screenshot({ path: 'test-results/animation-controls-desktop-zh.png' });
    expect(errors).toEqual([]);
});

test('canonical edits retain bindings through playback, undo, deletion and layer copies', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error(message.text()); } });
    await page.goto('/?load=/fixtures/conformance/scene.json');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.animation?.frame));
    const result = await page.evaluate(async () => {
        const scene = (window as any).scene;
        const events = scene.events;
        const splat = scene.elements.find((s: any) => s.animation);
        const wait = () => events.invoke('queue', () => {});
        await events.invoke('animation.prepare', 0.7);
        events.fire('select.all');
        await wait();
        const pivot = events.invoke('pivot');
        const changed = pivot.transform.clone();
        changed.position.x += 0.3;
        changed.rotation.setFromEulerAngles(20, 30, 10);
        changed.scale.set(1.3, 0.7, 1.1);
        events.fire('timeline.setPlaying', true);
        pivot.start();
        pivot.move(changed);
        pivot.end();
        await wait();
        const after = Array.from(splat.instances.canonicalEdits);
        const paused = !events.invoke('timeline.playing');
        await events.invoke('animation.prepare', 1.1);
        events.fire('edit.undo');
        await wait();
        const undone = Array.from(splat.instances.canonicalEdits);
        events.fire('edit.redo');
        await wait();
        const redone = Array.from(splat.instances.canonicalEdits);
        const texture = splat.animation.poseTexture;
        const pixels = await texture.read(0, 0, texture.width, texture.height, { data: new Float32Array(texture.width * texture.height * 4), immediate: true });
        let matrixError = 0;
        const matrix = splat.entity.getLocalTransform().clone();
        for (let i = 0; i < splat.instances.count; i++) {
            splat.animation.readMatrix(i, matrix);
            for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) matrixError = Math.max(matrixError,
                Math.abs(pixels[i * 16 + row * 4 + col] - matrix.data[col * 4 + row]));
        }
        events.fire('edit.duplicate');
        await wait();
        const copies = scene.elements.filter((s: any) => s.animation);
        const copied = copies.length === 2 && copies[1].resource === splat.resource &&
            copies[1].instances.canonicalEdits.every((x: number, i: number) => x === after[i]);
        events.fire('selection', splat);
        events.fire('select.delete');
        await wait();
        const deleted = splat.instances.count;
        events.fire('edit.undo');
        await wait();
        events.fire('edit.separate');
        await wait();
        const separated = splat.instances.count === 0 && scene.elements.filter((s: any) => s.animation).length === 3;
        events.fire('edit.undo');
        await wait();
        return { paused, copied, separated, matrixError, deleted, restored: splat.instances.count, after, undone, redone,
            restoredMatrices: Array.from(splat.instances.canonicalEdits) };
    });
    expect(result.paused).toBeTruthy();
    expect(result.redone).toEqual(result.after);
    expect(result.restoredMatrices).toEqual(result.after);
    expect(result.undone).not.toEqual(result.after);
    expect(result.copied).toBeTruthy();
    expect(result.separated).toBeTruthy();
    expect(result.matrixError).toBeLessThan(1e-5);
    expect(result.deleted).toBe(0);
    expect(result.restored).toBe(5);
    expect(errors).toEqual([]);
});

test('ssproj round trip preserves animation, shared layers, edits and timeline', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error(message.text()); } });
    await page.goto('/?load=/fixtures/conformance/scene.json');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.animation?.frame));
    const before = await page.evaluate(async () => {
        const events = (window as any).scene.events;
        events.fire('select.all');
        await events.invoke('queue', () => {});
        await events.invoke('animation.prepare', 0.7);
        const pivot = events.invoke('pivot');
        const transform = pivot.transform.clone();
        transform.position.y += 0.5;
        transform.scale.set(0.7, 1.3, 1.1);
        pivot.start(); pivot.move(transform); pivot.end();
        await events.invoke('queue', () => {});
        events.fire('edit.duplicate');
        await events.invoke('queue', () => {});
        events.fire('timeline.setSeconds', 0.7);
        events.fire('timeline.setPlaybackRate', 1.5);
        events.fire('animation.setBindingColors', true);
        const layer = events.invoke('selection');
        return { matrices: Array.from(layer.instances.canonicalEdits), ids: Array.from(layer.animation.provider.data.gaussians.sourceIds) };
    });
    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(async () => {
        (window as any).showDirectoryPicker = undefined;
        const events = (window as any).scene.events;
        events.functions.set('show.savePopup', async () => ({ filename: 'animation.ssproj' }));
        await events.invoke('doc.saveAs');
    });
    const download = await downloadPromise;
    await download.saveAs('test-results/animation.ssproj');
    await page.goto('/');
    await page.waitForFunction(() => (window as any).scene?.events?.functions.has('animation.prepare'));
    const after = await page.evaluate(async () => {
        const scene = (window as any).scene;
        const blob = await (await fetch('/fixtures/output/animation.ssproj')).blob();
        await scene.events.invoke('doc.load', new File([blob], 'animation.ssproj'));
        const layers = scene.events.invoke('animation.layers');
        return { count: layers.length, shared: layers[0].resource === layers[1].resource,
            sharedAnimation: layers[0].animation.provider.data === layers[1].animation.provider.data,
            matrices: Array.from(layers[0].instances.canonicalEdits), time: scene.events.invoke('timeline.seconds'),
            rate: scene.events.invoke('timeline.playbackRate'), colors: scene.events.invoke('animation.bindingColors'),
            ids: Array.from(layers[0].animation.provider.data.gaussians.sourceIds) };
    });
    expect(after.count).toBe(2);
    expect(after.shared).toBeTruthy();
    expect(after.sharedAnimation).toBeTruthy();
    expect(after.matrices).toEqual(before.matrices);
    expect(after.time).toBeCloseTo(0.7);
    expect(after.rate).toBe(1.5);
    expect(after.colors).toBeTruthy();
    expect(after.ids).toEqual(before.ids);
    expect(errors).toEqual([]);
});

test('static posed snapshot and standard BGS export re-import correctly', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error(message.text()); } });
    await page.goto('/?load=/fixtures/conformance/scene.json');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.animation?.frame));
    const expected = await page.evaluate(async () => {
        const events = (window as any).scene.events;
        events.fire('timeline.setSeconds', 0.7);
        await events.invoke('animation.prepare', 0.7);
        events.fire('select.all');
        await events.invoke('queue', () => {});
        const pivot = events.invoke('pivot');
        const transform = pivot.transform.clone();
        transform.position.z += 0.2;
        transform.scale.set(0.6, 1.2, 0.8);
        pivot.start(); pivot.move(transform); pivot.end();
        await events.invoke('queue', () => {});
        const splat = events.invoke('selection');
        const g = splat.animation.provider.data.gaussians;
        const matrix = splat.entity.getWorldTransform().clone();
        const point = pivot.transform.position.clone();
        const result: any[] = [];
        for (let i = 0; i < splat.instances.count; i++) {
            const row = splat.animation.sourceRows[splat.instances.sourceRow[i]];
            splat.animation.readMatrix(i, matrix);
            matrix.mul2(splat.entity.getWorldTransform(), matrix);
            point.set(...g.positions.subarray(row * 3, row * 3 + 3));
            matrix.transformPoint(point, point);
            result.push({ position: [point.x, point.y, point.z], matrix: Array.from(matrix.data),
                rotation: Array.from(g.rotations.subarray(row * 4, row * 4 + 4)), scales: Array.from(g.logScales.subarray(row * 3, row * 3 + 3)) });
        }
        return result;
    });
    for (const [type, filename] of [['ply', 'snapshot.ply'], ['bgs', 'roundtrip.bgs.zip']]) {
        const downloadPromise = page.waitForEvent('download');
        const written = await page.evaluate(({ type, filename }) => (window as any).scene.events.invoke('scene.write', type,
            { filename, splatIdx: 'all', serializeSettings: {} }), { type, filename });
        expect(written).toBeTruthy();
        await (await downloadPromise).saveAs(`test-results/${filename}`);
    }
    const restored = await page.evaluate(async () => {
        const scene = (window as any).scene;
        scene.events.functions.set('showPopup', async (options: any) => { console.error('Import popup', JSON.stringify(options)); return { action: 'ok' }; });
        const imports: any[] = [];
        for (const filename of ['snapshot.ply', 'roundtrip.bgs.zip']) {
            const blob = await (await fetch(`/fixtures/output/${filename}`)).blob();
            const layers = await scene.events.invoke('import', [{ filename, contents: new File([blob], filename) }]);
            imports.push(layers[0]);
        }
        const staticLayer = imports[0];
        const source = staticLayer.resource.source;
        const pool = staticLayer.resource.sourcePool;
        const position = pool.acquire('position', source.meta.layouts.position, source.meta.numGaussians);
        const geometric = pool.acquire('geometric', source.meta.layouts.geometric, source.meta.numGaussians);
        await source.read({ chunkIndex: 0, position, geometric });
        const result = { positions: Array.from(new Float32Array(position.data).subarray(0, source.meta.numGaussians * 3)), geometry: Array.from(new Float32Array(geometric.data).subarray(0, source.meta.numGaussians * 8)),
            world: Array.from(staticLayer.entity.getWorldTransform().data), count: imports[1].instances.count,
            clips: imports[1].animation.provider.asset.clips.length, ids: Array.from(imports[1].animation.provider.data.gaussians.sourceIds) };
        position.release(); geometric.release();
        return result;
    });
    expect(restored.count).toBe(5);
    expect(restored.clips).toBe(1);
    for (let i = 0; i < 5; i++) {
        const raw = restored.positions.slice(i * 3, i * 3 + 3) as number[];
        const m = restored.world as number[];
        const world = [0, 1, 2].map(axis => m[axis] * raw[0] + m[4 + axis] * raw[1] + m[8 + axis] * raw[2] + m[12 + axis]);
        const original = expected.slice().sort((a, b) => a.position.reduce((sum: number, value: number, k: number) => sum + (value - world[k]) ** 2, 0) -
            b.position.reduce((sum: number, value: number, k: number) => sum + (value - world[k]) ** 2, 0))[0];
        world.forEach((value, k) => expect(value).toBeCloseTo(original.position[k], 5));
        const geometry = restored.geometry.slice(i * 8, i * 8 + 8) as number[];
        const actual = new Float64Array(9);
        transformCovariance(m, gaussianCovariance([geometry[1], geometry[2], geometry[3], geometry[0]], geometry.slice(4, 7)), actual);
        const target = new Float64Array(9);
        transformCovariance(original.matrix, gaussianCovariance(original.rotation, original.scales), target);
        actual.forEach((value, k) => expect(value).toBeCloseTo(target[k], 5));
    }
    expect(errors).toEqual([]);
});

test('posed data queries reconstruct the edited covariance and keep color preview separate', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error(message.text()); } });
    await page.goto('/?load=/fixtures/conformance/scene.json');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.animation?.frame));
    const result = await page.evaluate(async () => {
        const scene = (window as any).scene;
        const events = scene.events;
        const wait = () => events.invoke('queue', () => {});
        events.fire('timeline.setSeconds', 0.7);
        await events.invoke('animation.prepare', 0.7);
        events.fire('select.all'); await wait();
        const pivot = events.invoke('pivot');
        const transform = pivot.transform.clone();
        transform.rotation.setFromEulerAngles(15, 25, 35);
        transform.scale.set(1.5, 0.8, 1.2);
        pivot.start(); pivot.move(transform); pivot.end(); await wait();
        const splat = events.invoke('selection');
        const row = 2;
        const instance = splat.animation.sourceRows.findIndex((value: number) => value === row);
        const mask = new Uint8Array(splat.instances.count).fill(255); mask[instance] = 0;
        events.fire('select.mask', 'set', mask); await wait();
        events.fire('select.hide'); await wait();
        const options = { entityMatrix: splat.entity.getWorldTransform(), cameraWorldPos: scene.camera.position };
        const properties: number[] = [];
        for (const property of [9, 10, 11, 14, 15, 16, 17]) {
            const histogram = await scene.dataProcessor.calcHistogram(splat, property, options);
            if (histogram.numValues !== 1) throw new Error('Expected one visible Gaussian in inspector test');
            properties.push(histogram.min);
        }
        const colorBefore = await scene.dataProcessor.calcHistogram(splat, 5, options);
        events.fire('animation.setBindingColors', true);
        const colorAfter = await scene.dataProcessor.calcHistogram(splat, 5, options);
        const matrix = splat.entity.getWorldTransform().clone();
        splat.animation.readMatrix(instance, matrix);
        matrix.mul2(splat.entity.getWorldTransform(), matrix);
        const g = splat.animation.provider.data.gaussians;
        return { properties, matrix: Array.from(matrix.data), rotation: Array.from(g.rotations.subarray(row * 4, row * 4 + 4)),
            scales: Array.from(g.logScales.subarray(row * 3, row * 3 + 3)), sameColor: colorBefore.min === colorAfter.min };
    });
    const [sx, sy, sz, w, x, y, z] = result.properties;
    const actual = gaussianCovariance([x, y, z, w], [Math.log(sx), Math.log(sy), Math.log(sz)]);
    const expected = new Float64Array(9);
    transformCovariance(result.matrix, gaussianCovariance(result.rotation, result.scales), expected);
    const magnitude = Math.max(...expected.map(Math.abs));
    const relativeError = Math.max(...actual.map((value, i) => Math.abs(value - expected[i]) / magnitude));
    console.log('packed GPU covariance query relative error', relativeError);
    expect(relativeError).toBeLessThan(0.005);
    expect(result.sameColor).toBeTruthy();
    expect(errors).toEqual([]);
});

test('rapid seeks publish only the latest time on every layer and failed poses stay valid', async ({ page }) => {
    await page.goto('/?load=/fixtures/conformance/scene.json');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.animation?.frame));
    const result = await page.evaluate(async () => {
        const scene = (window as any).scene;
        const events = scene.events;
        events.fire('select.all'); await events.invoke('queue', () => {});
        events.fire('edit.duplicate'); await events.invoke('queue', () => {});
        const times: number[] = [];
        let synchronized = true;
        const handler = events.on('animation.frame', () => {
            const layers = events.invoke('animation.layers');
            const time = layers[0].animation.frame.time;
            times.push(time);
            synchronized &&= layers.every((s: any) => s.animation.frame.time === time);
        });
        for (let i = 0; i < 100; i++) events.fire('timeline.setSeconds', i / 100);
        await events.invoke('queue', () => {});
        handler.off();
        const layers = events.invoke('animation.layers');
        const original = layers[0].animation.frame;
        layers[0].animation.clipId = 'missing-clip';
        let failed = false;
        try { await events.invoke('animation.prepare', 0.4); } catch { failed = true; }
        const preserved = layers[0].animation.frame === original;
        events.fire('scene.clear'); await events.invoke('queue', () => {});
        return { times, synchronized, failed, preserved, cleared: events.invoke('animation.layers').length === 0 };
    });
    expect(result.times.length).toBeGreaterThan(0);
    expect(result.times.every(time => Math.abs(time - 0.99) < 1e-12)).toBeTruthy();
    expect(result.synchronized).toBeTruthy();
    expect(result.failed).toBeTruthy();
    expect(result.preserved).toBeTruthy();
    expect(result.cleared).toBeTruthy();
});

test('video waits for exact frames and restores the viewport pose', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/?load=/fixtures/conformance/scene.json');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.animation?.frame));
    const downloadPromise = page.waitForEvent('download');
    const result = await page.evaluate(async () => {
        const scene = (window as any).scene;
        const events = scene.events;
        events.fire('timeline.setSeconds', 0.7);
        await events.invoke('animation.prepare', 0.7);
        const times: number[] = [];
        const handler = events.on('animation.frame', (splat: any) => times.push(splat.animation.frame.time));
        const ok = await events.invoke('render.video', { startFrame: 0, endFrame: 2, frameRate: 30, width: 64, height: 64,
            bitrate: 1000000, transparentBg: false, showDebug: false, format: 'webm', codec: 'vp9' });
        handler.off();
        return { ok, times, restored: events.invoke('animation.layers')[0].animation.frame.time,
            enabled: !document.querySelector('#animation-controls').classList.contains('pcui-disabled') };
    });
    expect(result.ok).toBeTruthy();
    await (await downloadPromise).saveAs('test-results/animation.webm');
    expect(result.times).toContain(0);
    expect(result.times.some(time => Math.abs(time - 1 / 30) < 1e-6)).toBeTruthy();
    expect(result.restored).toBeCloseTo(0.7);
    expect(result.enabled).toBeTruthy();
    expect(errors).toEqual([]);
});
