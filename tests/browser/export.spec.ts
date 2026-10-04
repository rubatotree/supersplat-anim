import { expect, test } from '@playwright/test';

test('static compressed exports contain the posed means and unsupported SH placement is explicit', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/?load=/fixtures/conformance/scene.json');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.animation?.frame));
    const expected = await page.evaluate(async () => {
        const scene = (window as any).scene;
        scene.events.fire('timeline.setSeconds', 0.7);
        await scene.events.invoke('animation.prepare', 0.7);
        const s = scene.events.invoke('animation.layers')[0];
        const m = s.entity.getWorldTransform().clone();
        const p = scene.camera.position.clone();
        const g = s.animation.provider.data.gaussians;
        return Array.from({ length: s.instances.count }, (_, i) => {
            const row = s.animation.sourceRows[s.instances.sourceRow[i]];
            s.animation.readMatrix(i, m); m.mul2(s.entity.getWorldTransform(), m);
            p.set(...g.positions.subarray(row * 3, row * 3 + 3)); m.transformPoint(p, p);
            return [p.x, p.y, p.z];
        });
    });
    for (const [type, filename, version] of [['splat', 'snapshot.splat', 4], ['compressedPly', 'snapshot.compressed.ply', 4],
        ['spz', 'snapshot3.spz', 3], ['spz', 'snapshot4.spz', 4], ['sog', 'snapshot.sog', 4]] as const) {
        const downloading = page.waitForEvent('download');
        expect(await page.evaluate(({ type, filename, version }) => (window as any).scene.events.invoke('scene.write', type,
            { filename, splatIdx: 'all', spzVersion: version, sogIterations: 1, serializeSettings: {} }), { type, filename, version })).toBeTruthy();
        await (await downloading).saveAs(`test-results/${filename}`);
        const actual = await page.evaluate(async (name) => {
            const scene = (window as any).scene;
            const blob = await (await fetch(`/fixtures/output/${name}`)).blob();
            const s = (await scene.events.invoke('import', [{ filename: name, contents: new File([blob], name) }]))[0];
            const source = s.resource.source;
            const position = s.resource.sourcePool.acquire('position', source.meta.layouts.position, source.meta.numGaussians);
            await source.read({ chunkIndex: 0, position });
            const raw = new Float32Array(position.data);
            const p = scene.camera.position.clone();
            const means = Array.from({ length: s.instances.count }, (_, i) => {
                const row = s.instances.sourceRow[i];
                p.set(...raw.subarray(row * 3, row * 3 + 3)); s.entity.getWorldTransform().transformPoint(p, p);
                return [p.x, p.y, p.z];
            });
            position.release(); s.destroy();
            return means;
        }, filename);
        expect(actual.length).toBe(5);
        for (const mean of actual) expect(Math.min(...expected.map(point => Math.hypot(...point.map((v, k) => v - mean[k]))))).toBeLessThan(0.005);
    }
    const refused = await page.evaluate(async () => {
        const scene = (window as any).scene;
        const messages: string[] = [];
        scene.events.functions.set('showPopup', async (options: any) => { messages.push(options.message); return { action: 'ok' }; });
        const s = scene.events.invoke('animation.layers')[0];
        s.entity.setLocalScale(1, 2, 1);
        const ok = await scene.events.invoke('scene.write', 'ply', { filename: 'unsupported.ply', splatIdx: 'all', serializeSettings: {} });
        return { ok, messages };
    });
    expect(refused.ok).toBeFalsy();
    expect(refused.messages.join(' ')).toContain('non-uniform');
    expect(errors).toEqual([]);
});

test('image capture prepares the current animation time and releases controls', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/?load=/fixtures/conformance/scene.json');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.animation?.frame));
    await page.evaluate(() => (window as any).scene.events.fire('timeline.setSeconds', 0.7));
    const downloading = page.waitForEvent('download');
    expect(await page.evaluate(() => (window as any).scene.events.invoke('render.image', {
        width: 64, height: 64, transparentBg: false, showDebug: false, format: 'png'
    }))).toBeTruthy();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/\.png$/);
    await download.saveAs('test-results/posed-screenshot.png');
    expect(await page.evaluate(() => {
        const scene = (window as any).scene;
        return { time: scene.events.invoke('animation.layers')[0].animation.frame.time,
            capturing: scene.events.invoke('animation.capturing'),
            controls: !document.querySelector('#animation-controls').classList.contains('pcui-disabled') };
    })).toEqual({ time: 0.7, capturing: false, controls: true });
    expect(errors).toEqual([]);
});
