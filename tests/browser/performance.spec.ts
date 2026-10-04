import { writeFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

for (const kind of ['stress', 'real']) {
    test(`${kind} 350k animation performance at 1920x1080 with static baseline`, async ({ page }, testInfo) => {
        test.skip(process.env.BGS_SKIP_PERF === '1', 'Performance capture explicitly disabled');
        test.skip(kind === 'real' && process.env.BGS_SKIP_REAL === '1', 'Real sample explicitly disabled');
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.goto(`/?load=/fixtures/${kind}/scene.json`);
        await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.animation?.frame));
        await expect(page.locator('#animation-controls')).toBeVisible();
        const report = await page.evaluate(async () => {
            const scene = (window as any).scene;
            const events = scene.events;
            const splat = events.invoke('animation.layers')[0];
            const animation = splat.animation;
            const adapter = scene.app.graphicsDevice.gpuAdapter;
            const info = adapter.info;
            const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
            const percentile = (values: number[], fraction: number) => {
                const sorted = values.slice().sort((a, b) => a - b);
                return sorted[Math.floor((sorted.length - 1) * fraction)] ?? null;
            };
            events.fire('view.setPerfOverlay', true);
            events.fire('view.setStochastic', 'off');
            events.fire('timeline.setLoop', true);
            events.fire('timeline.setSeconds', 0);
            events.fire('camera.focus');
            scene.camera.startOffscreenMode(1920, 1080);
            const actualTarget = [scene.camera.mainTarget.width, scene.camera.mainTarget.height];
            const force = scene.app.on('update', () => { scene.forceRender = true; });
            const sample = async (animated: boolean) => {
                let frames = 0;
                let poses = 0;
                let lastTime = 0;
                const rendered = events.on('postrender', () => frames++);
                const committed = events.on('animation.frame', (s: any) => { poses++; lastTime = s.animation.frame.time; });
                scene.frameTimings.cpu.length = scene.frameTimings.gpu.length = 0;
                events.fire('timeline.setPlaying', animated);
                const start = performance.now();
                await delay(4000);
                const elapsed = performance.now() - start;
                events.fire('timeline.setPlaying', false);
                rendered.off(); committed.off();
                await events.invoke('queue', () => {});
                const t = scene.frameTimings;
                return { elapsedMs: elapsed, renderedFps: frames * 1000 / elapsed, committedPoseFps: poses * 1000 / elapsed,
                    lastTime, gpuTimestampSupported: t.gpuSupported,
                    gpuMedianMs: t.gpuSupported ? percentile(t.gpu, 0.5) : null,
                    gpuP95Ms: t.gpuSupported ? percentile(t.gpu, 0.95) : null,
                    cpuMedianMs: percentile(t.cpu, 0.5), cpuP95Ms: percentile(t.cpu, 0.95),
                    gpuWorkingSet: scene.projectedSplatRenderer.stats };
            };
            await delay(1500);
            const animated = await sample(true);
            events.fire('animation.freeze');
            await events.invoke('queue', () => {});
            splat.animation = null;
            splat.changedCounter++;
            await delay(1500);
            const staticBaseline = await sample(false);
            splat.animation = animation;
            splat.changedCounter++;
            force.off();
            scene.camera.endOffscreenMode();
            return { count: splat.instances.count, assetId: animation.provider.asset.id, target: actualTarget,
                adapter: { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description,
                    isFallbackAdapter: adapter.isFallbackAdapter }, animated, staticBaseline };
        });
        console.log(`${kind} performance`, JSON.stringify(report));
        await writeFile(testInfo.outputPath(`${kind}-performance.json`), JSON.stringify(report, null, 2));
        await testInfo.attach(`${kind}-performance.json`, { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
        expect(report.count).toBe(350000);
        expect(report.target).toEqual([1920, 1080]);
        expect(report.animated.committedPoseFps).toBeGreaterThan(0);
        expect(errors).toEqual([]);
    });
}
