import { writeFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

test('350k attribute views report frame cost and release auxiliary GPU targets', async ({ page }, testInfo) => {
    test.skip(process.env.BGS_SKIP_PERF === '1', 'Performance capture explicitly disabled');
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/?load=/fixtures/stress/scene.json');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.animation?.frame));
    const report = await page.evaluate(async () => {
        const scene = (window as any).scene;
        const splat = scene.elements.find((s: any) => s.animation);
        scene.events.fire('view.setPerfOverlay', true);
        const force = scene.events.on('postrender', () => { scene.forceRender = true; });
        const reports = [];
        const waitFrames = (count: number) => new Promise<void>(resolve => {
            const handle = scene.events.on('postrender', () => { if (--count <= 0) { handle.off(); resolve(); } });
        });
        try {
            for (const mode of ['color','depth','normal','pseudo-normal','color']) {
                splat.attributeSettings = { ...splat.attributeSettings, mode };
                splat.changedCounter++; scene.forceRender = true;
                await waitFrames(8);
                const start = performance.now();
                await waitFrames(30);
                reports.push({ mode, frameMs: (performance.now()-start)/30, ...scene.projectedSplatRenderer.stats });
            }
            return { count: splat.instances.count, target: [scene.targetSize.width,scene.targetSize.height], reports };
        } finally { force.off(); }
    });
    console.log('attribute performance', JSON.stringify(report));
    await writeFile(testInfo.outputPath('attribute-performance.json'), JSON.stringify(report,null,2));
    expect(report.count).toBe(350000);
    expect(report.reports.every(r => Number.isFinite(r.frameMs) && r.frameMs > 0)).toBeTruthy();
    expect(report.reports[3].pseudoNormalBytes).toBeGreaterThan(report.reports[0].pseudoNormalBytes);
    expect(report.reports[4].pseudoNormalBytes).toBe(report.reports[0].pseudoNormalBytes);
    expect(errors).toEqual([]);
});
