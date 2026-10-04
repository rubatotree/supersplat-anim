import { expect, test } from '@playwright/test';

test('real robot and cube bindings survive affine edits and standard BGS subset export', async ({ page }) => {
    test.skip(process.env.BGS_SKIP_REAL === '1', 'Real sample explicitly disabled');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/?load=/fixtures/real/scene.json');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.animation?.frame));
    await expect(page.locator('#animation-controls')).toBeVisible();
    const edited = await page.evaluate(async () => {
        const scene = (window as any).scene;
        const events = scene.events;
        const original = events.invoke('animation.layers')[0];
        const g = original.animation.provider.data.gaussians;
        const mask = new Uint8Array(original.instances.count);
        const nodes = new Set<number>();
        for (let i = 0; i < original.instances.count; i++) {
            const row = original.animation.sourceRows[original.instances.sourceRow[i]];
            const node = g.dominantNodes[row];
            if (node > 0 && !nodes.has(node)) { nodes.add(node); mask[i] = 255; }
        }
        events.fire('select.mask', 'set', mask); await events.invoke('queue', () => {});
        events.fire('edit.separate'); await events.invoke('queue', () => {});
        const layer = events.invoke('selection');
        events.fire('timeline.setSeconds', 0.7);
        await events.invoke('animation.prepare', 0.7);
        events.fire('select.all'); await events.invoke('queue', () => {});
        const pivot = events.invoke('pivot');
        const transform = pivot.transform.clone();
        transform.position.x += 0.05;
        transform.rotation.setFromEulerAngles(5, 10, 15);
        transform.scale.set(0.9, 1.2, 0.8);
        pivot.start(); pivot.move(transform); pivot.end(); await events.invoke('queue', () => {});
        let maxError = 0;
        for (const clip of layer.animation.provider.asset.clips) {
            layer.animation.clipId = clip.id;
            await events.invoke('animation.prepare', clip.duration * 0.6);
            const texture = layer.animation.poseTexture;
            const pixels = await texture.read(0, 0, texture.width, texture.height,
                { data: new Float32Array(texture.width * texture.height * 4), immediate: true });
            const matrix = layer.entity.getWorldTransform().clone();
            for (let i = 0; i < layer.instances.count; i++) {
                layer.animation.readMatrix(i, matrix);
                for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) maxError = Math.max(maxError,
                    Math.abs(pixels[i * 16 + r * 4 + c] - matrix.data[c * 4 + r]));
            }
        }
        return { count: layer.instances.count, nodes: Array.from(nodes), maxError,
            ids: Array.from(layer.instances.sourceRow.subarray(0, layer.instances.count), (row: number) => g.sourceIds[layer.animation.sourceRows[row]]) };
    });
    const downloadPromise = page.waitForEvent('download');
    expect(await page.evaluate(() => (window as any).scene.events.invoke('scene.write', 'bgs',
        { filename: 'real-edited-subset.bgs.zip', splatIdx: 'all', serializeSettings: {} }))).toBeTruthy();
    await (await downloadPromise).saveAs('test-results/real-edited-subset.bgs.zip');
    const reloaded = await page.evaluate(async () => {
        const scene = (window as any).scene;
        const blob = await (await fetch('/fixtures/output/real-edited-subset.bgs.zip')).blob();
        const result = await scene.events.invoke('import', [{ filename: 'real-edited-subset.bgs.zip', contents: new File([blob], 'real-edited-subset.bgs.zip') }]);
        return { count: result[0].instances.count, clips: result[0].animation.provider.asset.clips.length,
            ids: Array.from(result[0].animation.provider.data.gaussians.sourceIds) };
    });
    console.log('real edited subset', edited);
    expect(edited.nodes.length).toBeGreaterThan(1);
    expect(edited.nodes).toContain(9);
    expect(edited.maxError).toBeLessThan(1e-5);
    expect(reloaded.count).toBe(edited.count);
    expect(reloaded.ids).toEqual(edited.ids);
    expect(reloaded.clips).toBe(2);
    const projectDownload = page.waitForEvent('download');
    await page.evaluate(async () => {
        (window as any).showDirectoryPicker = undefined;
        const events = (window as any).scene.events;
        events.functions.set('show.savePopup', async () => ({ filename: 'real-edited.ssproj' }));
        await events.invoke('doc.saveAs');
    });
    await (await projectDownload).saveAs('test-results/real-edited.ssproj');
    const restored = await page.evaluate(async () => {
        const scene = (window as any).scene;
        scene.events.fire('scene.clear');
        const blob = await (await fetch('/fixtures/output/real-edited.ssproj')).blob();
        await scene.events.invoke('doc.load', new File([blob], 'real-edited.ssproj'));
        const layers = scene.events.invoke('animation.layers');
        const edited = layers.find((s: any) => s.instances.canonicalEdits);
        const data = edited.animation.provider.data;
        return { layers: layers.length, total: layers.reduce((n: number, s: any) => n + s.instances.count, 0),
            shared: layers[0].resource === layers[1].resource,
            editedIds: Array.from(edited.instances.sourceRow.subarray(0, edited.instances.count), (row: number) =>
                data.gaussians.sourceIds[edited.animation.sourceRows[row]]) };
    });
    expect(restored.layers).toBe(3);
    expect(restored.total).toBe(350000 + edited.count);
    expect(restored.shared).toBeTruthy();
    expect(restored.editedIds).toEqual(edited.ids);
    expect(errors).toEqual([]);
});
