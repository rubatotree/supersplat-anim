import { expect, test } from '@playwright/test';

test('posed selection modes, volume tools, lock/reset and render overlays remain usable', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/?load=/fixtures/conformance/scene.json');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.animation?.frame));
    const result = await page.evaluate(async () => {
        const scene = (window as any).scene;
        const events = scene.events;
        const splat = events.invoke('animation.layers')[0];
        const wait = () => events.invoke('queue', () => {});
        events.fire('timeline.setSeconds', 0.7);
        await events.invoke('animation.prepare', 0.7);
        events.fire('camera.focus');
        await new Promise(resolve => setTimeout(resolve, 1100));
        const counts: number[] = [];
        const paused: boolean[] = [];
        for (const [depth, footprint] of [[false, 0], [false, 1], [true, 0], [true, 1]]) {
            events.fire('selection.setUseDepth', depth);
            events.fire('selection.setFootprint', footprint);
            events.fire('timeline.setPlaying', true);
            await events.invoke('select.rect', 'set', { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } });
            await wait();
            counts.push(splat.numSelected);
            paused.push(!events.invoke('timeline.playing'));
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
            const context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0, 0, 64, 64);
            await events.invoke('select.byMask', 'set', canvas, context); await wait();
            counts.push(splat.numSelected);
        }
        const volume = splat.entity.getWorldTransform().clone().setScale(100, 100, 100);
        for (const event of ['select.bySphere', 'select.byBox']) {
            events.fire(event, 'set', volume); await wait(); counts.push(splat.numSelected);
        }
        events.fire('select.all'); await wait();
        events.fire('select.hide'); await wait();
        const locked = splat.instances.flags.subarray(0, splat.instances.count).every((flag: number) => !!(flag & 2));
        events.fire('select.all'); await wait();
        events.fire('select.delete'); await wait();
        const protectedCount = splat.instances.count;
        events.fire('select.unhide'); await wait();
        events.fire('select.all'); await wait();
        events.fire('select.delete'); await wait();
        events.fire('scene.reset'); await wait();
        const restoredCount = splat.instances.count;
        const restoredBindings = splat.instances.sourceRow.subarray(0, splat.instances.count).every((row: number) =>
            Number.isFinite(splat.animation.provider.data.gaussians.sourceIds[splat.animation.sourceRows[row]]));
        const views: string[] = [];
        for (const view of ['Gaussians', 'Centers', 'Rings', 'OutlineSelection', 'Overdraw']) {
            events.fire(`view.set${view}`, true);
            events.fire('animation.setBindingColors', true);
            scene.forceRender = true;
            await new Promise(resolve => events.once('postrender', resolve));
            views.push(view);
            events.fire(`view.set${view}`, false);
        }
        events.fire('view.setGaussians', true);
        return { counts, paused, locked, protectedCount, restoredCount, restoredBindings, views };
    });
    console.log('posed tool regression', result);
    expect(result.counts.every(count => count > 0)).toBeTruthy();
    expect(result.paused.every(Boolean)).toBeTruthy();
    expect(result.locked).toBeTruthy();
    expect(result.protectedCount).toBe(5);
    expect(result.restoredCount).toBe(5);
    expect(result.restoredBindings).toBeTruthy();
    expect(errors).toEqual([]);
});

test('posed depth drives sphere brush, color selection, measurement and orientation gestures', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/?load=/fixtures/conformance/scene.json');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.animation?.frame));
    const result = await page.evaluate(async () => {
        const scene = (window as any).scene;
        const events = scene.events;
        const s = events.invoke('animation.layers')[0];
        events.fire('timeline.setSeconds', 0.7);
        await events.invoke('animation.prepare', 0.7);
        events.fire('camera.focus');
        await new Promise(resolve => setTimeout(resolve, 1100));
        const point = scene.camera.position.clone();
        const screen = point.clone();
        const m = s.entity.getWorldTransform().clone();
        const g = s.animation.provider.data.gaussians;
        const candidates: { x: number, y: number }[] = [];
        for (let i = 0; i < s.instances.count; i++) {
            const row = s.animation.sourceRows[s.instances.sourceRow[i]];
            s.animation.readMatrix(i, m); m.mul2(s.entity.getWorldTransform(), m);
            point.set(...g.positions.subarray(row * 3, row * 3 + 3)); m.transformPoint(point, point);
            scene.camera.worldToScreen(point, screen);
            candidates.push({ x: screen.x, y: screen.y });
        }
        const hits = await scene.camera.intersectMany(candidates, [s]);
        const chosen = hits.findIndex((hit: any) => !!hit);
        if (chosen < 0) throw new Error('No posed Gaussian depth at projected means');
        const location = candidates[chosen];
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
        const context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0, 0, 64, 64);
        events.fire('timeline.setPlaying', true);
        await events.invoke('select.bySphereBrush', 'set', [{ ...location, radius: 40 }], canvas);
        await events.invoke('queue', () => {});
        const brushed = s.numSelected;
        const paused = !events.invoke('timeline.playing');
        await events.invoke('select.colorMatch', 'set', location, 1); await events.invoke('queue', () => {});
        const colorSelected = s.numSelected;
        const container = document.querySelector('#canvas-container');
        const bounds = container.getBoundingClientRect();
        const click = () => {
            for (const type of ['pointerdown', 'pointerup']) container.dispatchEvent(new PointerEvent(type, {
                bubbles: true, pointerType: 'mouse', pointerId: 1, isPrimary: true, button: 0,
                clientX: bounds.left + location.x * bounds.width, clientY: bounds.top + location.y * bounds.height
            }));
        };
        const waitPoint = async (points: any[]) => {
            for (let i = 0; i < 60 && !points.length; i++) await new Promise(resolve => setTimeout(resolve, 16));
            return points.length;
        };
        events.fire('tool.measure'); click(); const measured = await waitPoint(s.measurePoints);
        events.fire('tool.orient'); click(); const oriented = await waitPoint(s.orientPoints);
        events.fire('tool.deactivate');
        return { depthHit: Number.isFinite(hits[chosen].distance), brushed, colorSelected, paused, measured, oriented };
    });
    expect(result.depthHit).toBeTruthy();
    expect(result.brushed).toBeGreaterThan(0);
    expect(result.colorSelected).toBeGreaterThan(0);
    expect(result.paused).toBeTruthy();
    expect(result.measured).toBe(1);
    expect(result.oriented).toBe(1);
    expect(errors).toEqual([]);
});
