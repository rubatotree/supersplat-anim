import { expect, test } from '@playwright/test';

test('shared GPU pose agrees with CPU and survives rendering and picking', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
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
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
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
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/?load=/fixtures/conformance/gaussians.ply');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.instances?.count === 5));
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
});

test('animation controls expose bind pose, colors, source frames and narrow layout', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/?load=/fixtures/conformance/scene.json');
    await expect(page.locator('#animation-controls')).toBeVisible();
    await page.locator('#animation-bind').click();
    await expect(page.locator('#animation-samples')).toHaveText('Bind pose');
    await page.locator('#animation-colors').click();
    await expect(page.locator('#animation-colors')).toHaveClass(/active/);
    await page.locator('#animation-bind').click();
    await expect(page.locator('#animation-samples')).toContainText('Sample');
    await page.setViewportSize({ width: 640, height: 720 });
    await page.screenshot({ path: 'test-results/animation-controls-narrow.png' });
    expect(await page.locator('#animation-controls').evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
    expect(errors).toEqual([]);
});

test('canonical edits retain bindings through playback, undo, deletion and layer copies', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
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
