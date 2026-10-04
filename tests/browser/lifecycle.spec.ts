import { expect, test } from '@playwright/test';

test('clear during import discards late resources and repeated imports release their providers', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/');
    await page.waitForFunction(() => (window as any).scene?.events.functions.has('animation.import'));
    let unblock: () => void;
    let requested: () => void;
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    const started = new Promise<void>(resolve => { requested = resolve; });
    await page.route('**/fixtures/conformance/animation.bin', async route => {
        requested(); await gate; await route.continue();
    });
    const loading = page.evaluate(() => (window as any).scene.events.invoke('import',
        [{ filename: 'scene.json', url: '/fixtures/conformance/scene.json' }]));
    await started;
    await page.evaluate(() => (window as any).scene.events.fire('scene.clear'));
    unblock();
    expect(await loading).toEqual([]);
    await page.unroute('**/fixtures/conformance/animation.bin');
    const result = await page.evaluate(async () => {
        const events = (window as any).scene.events;
        const counts: number[] = [];
        const disposed: boolean[] = [];
        for (let i = 0; i < 3; i++) {
            const layers = await events.invoke('import', [{ filename: 'scene.json', url: '/fixtures/conformance/scene.json' }]);
            counts.push(events.invoke('animation.layers').length);
            const provider = layers[0].animation.provider;
            events.fire('scene.clear');
            await events.invoke('queue', () => {});
            try { await provider.prepare('__bind__', 0, 1); disposed.push(false); } catch { disposed.push(true); }
        }
        return { counts, disposed, remaining: events.invoke('animation.layers').length };
    });
    expect(result.counts).toEqual([1, 1, 1]);
    expect(result.disposed).toEqual([true, true, true]);
    expect(result.remaining).toBe(0);
    expect(errors).toEqual([]);
});

test('capture blocks canvas edit shortcuts and scene clear cancels video cleanly', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/?load=/fixtures/conformance/scene.json');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.animation?.frame));
    const result = await page.evaluate(async () => {
        const scene = (window as any).scene;
        const events = scene.events;
        const layer = events.invoke('animation.layers')[0];
        events.fire('select.all'); await events.invoke('queue', () => {});
        events.fire('animation.captureBegin');
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true }));
        await events.invoke('queue', () => {});
        const protectedCount = layer.instances.count;
        events.fire('animation.captureEnd');
        const clear = events.once('progressUpdate', () => events.fire('scene.clear'));
        const ok = await events.invoke('render.video', { startFrame: 0, endFrame: 20, frameRate: 30,
            width: 64, height: 64, bitrate: 1000000, transparentBg: false, showDebug: false, format: 'webm', codec: 'vp9' });
        clear.off();
        return { protectedCount, ok, capturing: events.invoke('animation.capturing'),
            layers: events.invoke('animation.layers').length, locked: scene.lockedRenderMode,
            controlsEnabled: !document.querySelector('#animation-controls').classList.contains('pcui-disabled') };
    });
    expect(result).toEqual({ protectedCount: 5, ok: false, capturing: false, layers: 0, locked: false, controlsEnabled: true });
    expect(errors).toEqual([]);
});
