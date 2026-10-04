import { readFile, writeFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

test('version zero and one static projects still open with their transforms and timeline', async ({ page }) => {
    const { MemoryFileSystem, ZipFileSystem } = await import('@playcanvas/splat-transform');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/?load=/fixtures/conformance/gaussians.ply');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.instances?.count === 5));
    const settings = await page.evaluate(() => {
        const scene = (window as any).scene;
        return { camera: scene.camera.docSerialize(), view: scene.events.invoke('docSerialize.view'),
            poseSets: scene.events.invoke('docSerialize.poseSets'),
            timeline: { frames: 90, frameRate: 30, frame: 12, loop: false, smoothness: 1 },
            splats: [{ ...scene.events.invoke('selection').docSerialize(), position: [1, 2, 3] }] };
    });
    const ply = await readFile('tests/fixtures/bgs/gaussians.ply');
    for (const version of [0, 1]) {
        const memory = new MemoryFileSystem();
        const zip = new ZipFileSystem(memory.createWriter('legacy.ssproj'));
        const write = async (name: string, bytes: Uint8Array) => {
            const writer = await zip.createWriter(name); await writer.write(bytes); await writer.close();
        };
        const doc: any = { ...settings, version };
        if (version === 1) {
            doc.resources = [{ filename: 'resource_0.ply', numRows: 5 }];
            doc.splats = [{ ...settings.splats[0], resource: 0, instances: 'instances_0.bin' }];
            // Historical SSIL v1 layout: five rows, identity transform and grade.
            const blob = new Uint8Array((5 + 5 * 2 + 2 + 16 + 13) * 4);
            const words = new Uint32Array(blob.buffer); const floats = new Float32Array(blob.buffer);
            words.set([0x4c495353, 1, 5, 1, 1]); words.set([0, 1, 2, 3, 4], 5);
            for (const k of [0, 5, 10, 15]) floats[17 + k] = 1;
            for (const k of [0, 5, 10, 12]) floats[33 + k] = 1;
            await write('instances_0.bin', blob);
        }
        await write(version ? 'resource_0.ply' : 'splat_0.ply', ply);
        await write('document.json', new TextEncoder().encode(JSON.stringify(doc)));
        await zip.close();
        await writeFile(`test-results/legacy${version}.ssproj`, memory.results.get('legacy.ssproj'));
        const actual = await page.evaluate(async (v) => {
            const scene = (window as any).scene;
            scene.events.functions.set('showPopup', async (options: any) => {
                if (options.type === 'yesno') return { action: 'yes' };
                throw new Error(JSON.stringify(options));
            });
            const blob = await (await fetch(`/fixtures/output/legacy${v}.ssproj`)).blob();
            await scene.events.invoke('doc.load', new File([blob], `legacy${v}.ssproj`));
            const s = scene.events.invoke('selection');
            return { count: s.instances.count, animated: !!s.animation, position: s.docSerialize().position,
                seconds: scene.events.invoke('timeline.seconds'), frames: scene.events.invoke('timeline.frames') };
        }, version);
        expect(actual).toEqual({ count: 5, animated: false, position: [1, 2, 3], seconds: 0.4, frames: 90 });
    }
    expect(errors).toEqual([]);
});
