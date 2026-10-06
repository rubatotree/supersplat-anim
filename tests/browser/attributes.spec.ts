import { expect, test } from '@playwright/test';

test('attribute modes compile, render and preserve per-layer settings on WebGPU', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') { errors.push(message.text()); console.error(message.text().slice(0, 2000)); }
    });
    await page.goto('/?load=/fixtures/conformance/scene.json');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.animation?.frame));
    const results = [];
    for (const mode of ['depth', 'normal', 'binding', 'opacity', 'scalar', 'rgb', 'pseudo-normal', 'color']) {
        results.push(await page.evaluate(async (mode) => {
            const scene = (window as any).scene;
            const s = scene.elements.find((s: any) => s.animation);
            s.attributeSettings = { ...s.attributeSettings, mode, property: 'scale_0', channels: ['f_dc_0', 'f_dc_1', 'f_dc_2'] };
            s.changedCounter++;
            scene.forceRender = true;
            await new Promise<void>(resolve => {
                const wait = () => {
                    const p = scene.projectedSplatRenderer.placements.find((p: any) => p.splat === s);
                    if (p.attributes.settings.mode !== mode || p.attributes.loading) requestAnimationFrame(wait);
                    else resolve();
                };
                requestAnimationFrame(wait);
            });
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const p = scene.projectedSplatRenderer.placements.find((p: any) => p.splat === s);
            const pixels = await scene.camera.mainTarget.colorBuffer.read(0, 0, scene.targetSize.width, scene.targetSize.height, { immediate: true });
            const range = await p.range.buffer.read(0, 12, undefined, true);
            return { mode, active: p.attributes.settings.mode, bytes: pixels.byteLength,
                range: Array.from(new Uint32Array(range.buffer, range.byteOffset, 3)), stochastic: scene.movingRender,
                pseudoLayers: scene.projectedSplatRenderer.pseudoNormals.texture.arrayLength };
        }, mode));
    }
    console.log(results);
    expect(results.every(r => r.mode === r.active && r.bytes > 0)).toBeTruthy();
    expect(results.filter(r => ['depth', 'opacity', 'scalar'].includes(r.mode)).every(r => r.range[2] === 5)).toBeTruthy();
    expect(results.filter(r => r.mode !== 'color').every(r => !r.stochastic)).toBeTruthy();
    expect(results.find(r => r.mode === 'pseudo-normal').pseudoLayers).toBe(1);
    expect(errors).toEqual([]);
});

test('custom columns, authored normals and expected-depth pseudo normals have correct numeric values', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/');
    await page.waitForFunction(() => (window as any).scene?.events.functions.has('import'));
    await page.evaluate(async () => {
        const scene = (window as any).scene;
        scene.events.functions.set('showPopup', async (options: any) => { throw new Error(options.message); });
        const columns = ['x', 'y', 'z', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'scale_0', 'scale_1', 'scale_2', 'opacity', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'nx', 'ny', 'nz', 'heat', 'tint_r', 'tint_g', 'tint_b'];
        const rows = [
            [0,0,0,1,0,0,0,-1,-1,-3,0,0,0,0,1,1,0,-2,0.2,0.4,0.6],
            [0,0,-1,1,0,0,0,-1,-1,-3,0,0,0,0,0,0,0,4,0.8,0.7,0.3]
        ];
        const header = new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\nelement vertex 2\n${columns.map(n => `property float ${n}`).join('\n')}\nend_header\n`);
        const binary = new Uint8Array(rows.length * columns.length * 4);
        const view = new DataView(binary.buffer);
        rows.flat().forEach((v,i) => view.setFloat32(i*4,v,true));
        const [s] = await scene.events.invoke('import', [{ filename: 'attribute-fixture.ply', contents: new File([header,binary], 'attribute-fixture.ply') }]);
        s.entity.setLocalEulerAngles(0,0,0);
        scene.camera.setFocalPoint(s.entity.getPosition().clone(),0);
        scene.camera.setAzimElev(0,0,0);
        scene.camera.setDistance(5 / scene.camera.sceneRadius * scene.camera.fovFactor,0);
        (window as any).attributeFixture = s;
        (window as any).attributeFrame = async (mode: string) => {
            s.attributeSettings = { ...s.attributeSettings, mode, property: 'heat', channels: ['tint_r','tint_g','tint_b'] };
            s.changedCounter++; scene.forceRender = true;
            await new Promise<void>(resolve => {
                const wait = () => {
                    const p = scene.projectedSplatRenderer.placements.find((p: any) => p.splat === s);
                    if (p.attributes.settings.mode !== mode || p.attributes.loading) requestAnimationFrame(wait);
                    else resolve();
                };
                requestAnimationFrame(wait);
            });
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        };
    });
    const scalar = await page.evaluate(async () => {
        await (window as any).attributeFrame('scalar');
        const scene = (window as any).scene;
        const p = scene.projectedSplatRenderer.placements[0];
        const range = await p.range.buffer.read(0,12,undefined,true);
        const words = new Uint32Array(range.buffer,range.byteOffset,3);
        const decode = (b: number) => new Float32Array(new Uint32Array([(b & 0x80000000) ? b ^ 0x80000000 : ~b]).buffer)[0];
        return [decode(words[0]),decode(words[1]),words[2]];
    });
    expect(scalar).toEqual([-2,4,2]);
    for (const mode of ['rgb','normal']) {
        const rgb = await page.evaluate(async mode => {
            await (window as any).attributeFrame(mode);
            const scene = (window as any).scene;
            const p = scene.projectedSplatRenderer.placements[0];
            const words = await scene.projectedSplatRenderer.cacheA.read(p.entryBase % scene.projectedSplatRenderer.cacheWidth,
                Math.floor(p.entryBase / scene.projectedSplatRenderer.cacheWidth),1,1,{ immediate: true });
            const c = words[2];
            const sourceRow = p.splat.instances.sourceRow[0];
            const geometry = p.splat.resource.getTexture('transformA');
            const source = await geometry.read(sourceRow % geometry.width,Math.floor(sourceRow/geometry.width),1,1,{ immediate: true });
            const z = new Float32Array(source.buffer,source.byteOffset,4)[2];
            return { color: [(c & 1023)/1023,((c>>>10)&1023)/1023,((c>>>20)&1023)/1023], second: z < -0.5 };
        }, mode);
        const expected = mode === 'normal' ? (rgb.second ? [0.5,0.5,1] : [0.5+Math.SQRT1_2*0.5,0.5+Math.SQRT1_2*0.5,0.5]) : rgb.second ? [0.8,0.7,0.3] : [0.2,0.4,0.6];
        rgb.color.forEach((v,i) => expect(v).toBeCloseTo(expected[i],2));
    }
    const transformedNormal = await page.evaluate(async () => {
        const scene = (window as any).scene;
        const s = (window as any).attributeFixture;
        s.entity.setLocalScale(2,1,1); s.entity.setLocalEulerAngles(0,0,45);
        await (window as any).attributeFrame('normal');
        const renderer = scene.projectedSplatRenderer;
        const p = renderer.placements[0];
        const i = [...s.instances.sourceRow].findIndex(row => row === 1); // Morton order puts z=-1 first.
        const entry = p.entryBase+i;
        const words = await renderer.cacheA.read(entry%renderer.cacheWidth,Math.floor(entry/renderer.cacheWidth),1,1,{ immediate: true });
        const c = words[2];
        s.entity.setLocalScale(1,1,1); s.entity.setLocalEulerAngles(0,0,0);
        return [(c&1023)/1023,((c>>>10)&1023)/1023,((c>>>20)&1023)/1023];
    });
    const n = [-0.5*Math.SQRT1_2/Math.sqrt(1.25),1.5*Math.SQRT1_2/Math.sqrt(1.25),0];
    transformedNormal.forEach((v,i) => expect(v).toBeCloseTo(n[i]*0.5+0.5,2));
    for (const ortho of [false,true]) {
        const result = await page.evaluate(async ortho => {
            const scene = (window as any).scene;
            scene.camera.camera.projection = ortho ? 1 : 0;
            scene.camera.camera.orthoHeight = 2;
            await (window as any).attributeFrame('pseudo-normal');
            const pseudo = scene.projectedSplatRenderer.pseudoNormals;
            const w = pseudo.depth.width; const h = pseudo.depth.height;
            const decode = (values: any) => values instanceof Float32Array ? Array.from(values) : Array.from(values as Uint16Array).map(v => {
                const sign = v & 32768 ? -1 : 1; const exp = (v >> 10) & 31; const mantissa = v & 1023;
                return sign * (exp ? (1+mantissa/1024)*2**(exp-15) : mantissa*2**-24);
            });
            const d = decode(await pseudo.depth.colorBuffer.read(Math.floor(w/2),Math.floor(h/2),1,1,{ immediate: true }));
            const normal = decode(await pseudo.texture.read(Math.floor(w/2),Math.floor(h/2),1,1,{ immediate: true }));
            return { depth: d[0]/d[3] * Math.max(1, Math.abs(scene.camera.camera.farClip)), alpha: d[3], normal,
                expected: scene.camera.mainCamera.getWorldTransform().getZ().normalize().toArray() };
        }, ortho);
        console.log('pseudo fixture',ortho,result);
        expect(result.alpha).toBeCloseTo(0.75,2);
        expect(result.depth).toBeCloseTo(5+1/3,2);
        result.normal.slice(0,3).forEach((v,i) => expect(v).toBeCloseTo(0.5+0.5*result.expected[i],1));
    }
    await page.screenshot({ path: 'test-results/attribute-pseudo-normal.png' });
    expect(errors).toEqual([]);
});

test('colour-panel interaction, independent copies, project round trip and pseudo-normal image export', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/?load=/fixtures/conformance/scene.json');
    await page.waitForFunction(() => (window as any).scene?.elements.some((s: any) => s.animation?.frame));
    await page.locator('#right-toolbar-appearance').click();
    await page.locator('.attribute-mode').scrollIntoViewIfNeeded();
    await expect(page.locator('.color-panel-header svg')).toHaveCount(0);
    expect(await page.locator('.color-panel-header').getAttribute('role')).toBeNull();
    expect(await page.locator('#appearance-panel').evaluate(panel => panel.lastElementChild?.classList.contains('color-panel-section'))).toBeTruthy();
    await expect(page.locator('#scene-panel .color-panel-section')).toHaveCount(0);
    await expect(page.locator('#appearance-panel .attribute-panel')).toBeVisible();
    await page.locator('.attribute-mode').click();
    await page.getByText('Depth', { exact: true }).click();
    await page.locator('.attribute-panel .pcui-select-input').nth(1).click();
    await page.getByText('Inferno', { exact: true }).click();
    const history = await page.evaluate(async () => {
        const scene = (window as any).scene;
        await scene.events.invoke('queue', () => {});
        scene.events.fire('edit.undo');
        await scene.events.invoke('queue', () => {});
        const undone = scene.events.invoke('selection').attributeSettings.colormap;
        scene.events.fire('edit.redo');
        await scene.events.invoke('queue', () => {});
        return { undone, redone: scene.events.invoke('selection').attributeSettings.colormap, dirty: scene.events.invoke('scene.dirty') };
    });
    expect(history).toEqual({ undone: 'viridis', redone: 'inferno', dirty: true });
    await expect(page.locator('.attribute-legend')).toBeVisible();
    await expect(page.locator('.color-panel-button').first()).toHaveClass(/pcui-disabled/);
    await page.evaluate(() => {
        const scene = (window as any).scene;
        const s = scene.events.invoke('selection');
        s.attributeSettings.min = -1; s.attributeSettings.max = 10; s.attributeSettings.autoRange = false;
        scene.events.fire('splat.attributeChanged', s);
    });
    await page.screenshot({ path: 'test-results/attribute-color-panel.png' });
    const before = await page.evaluate(async () => {
        const scene = (window as any).scene;
        const s = scene.events.invoke('selection');
        scene.events.fire('select.all');
        await scene.events.invoke('queue', () => {});
        scene.events.fire('edit.duplicate');
        await scene.events.invoke('queue', () => {});
        const copy = scene.events.invoke('selection');
        const inherited = JSON.stringify(copy.attributeSettings) === JSON.stringify(s.attributeSettings);
        copy.attributeSettings = { ...copy.attributeSettings, mode: 'pseudo-normal' };
        copy.changedCounter++; scene.forceRender = true;
        return { inherited, original: s.attributeSettings.mode, copy: copy.attributeSettings.mode };
    });
    expect(before).toEqual({ inherited: true, original: 'depth', copy: 'pseudo-normal' });
    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(async () => {
        (window as any).showDirectoryPicker = undefined;
        const events = (window as any).scene.events;
        events.functions.set('show.savePopup', async () => ({ filename: 'attributes.ssproj' }));
        await events.invoke('doc.saveAs');
    });
    await (await downloadPromise).saveAs('test-results/attributes.ssproj');
    await page.goto('/');
    await page.waitForFunction(() => (window as any).scene?.events.functions.has('doc.load'));
    const restored = await page.evaluate(async () => {
        const scene = (window as any).scene;
        const blob = await (await fetch('/fixtures/output/attributes.ssproj')).blob();
        await scene.events.invoke('doc.load', new File([blob], 'attributes.ssproj'));
        return scene.elements.filter((s: any) => s.instances).map((s: any) => s.attributeSettings);
    });
    expect(restored.map((s: any) => s.mode).sort()).toEqual(['depth','pseudo-normal']);
    expect(restored.every((s: any) => s.colormap === 'inferno' && !s.autoRange && s.min === -1 && s.max === 10)).toBeTruthy();
    const imagePromise = page.waitForEvent('download');
    expect(await page.evaluate(async () => {
        const scene = (window as any).scene;
        const original = scene.elements.find((s: any) => s.instances && s.attributeSettings.mode === 'depth');
        original.attributeSettings = { ...original.attributeSettings, mode: 'scalar', property: 'f_dc_0' };
        original.changedCounter++;
        // 不等待 viewport 加载，捕获自身必须等待新列上传。
        return scene.events.invoke('render.image', {
            width: 128, height: 96, transparentBg: true, showDebug: false, format: 'png'
        });
    })).toBeTruthy();
    await (await imagePromise).saveAs('test-results/attribute-export.png');
    expect(await page.evaluate(() => (window as any).scene.projectedSplatRenderer.placements.some((p: any) =>
        p.attributes.settings.mode === 'scalar' && p.attributes.settings.property === 'f_dc_0'))).toBeTruthy();
    const videoPromise = page.waitForEvent('download');
    expect(await page.evaluate(() => (window as any).scene.events.invoke('render.video', {
        startFrame: 0, endFrame: 2, frameRate: 30, width: 64, height: 64,
        bitrate: 1000000, transparentBg: false, showDebug: false, format: 'webm', codec: 'vp9'
    }))).toBeTruthy();
    await (await videoPromise).saveAs('test-results/attribute-video.webm');
    await page.setViewportSize({ width: 390, height: 720 });
    await page.evaluate(() => (window as any).scene.events.fire('appearancePanel.setVisible', true));
    await page.locator('.attribute-mode').scrollIntoViewIfNeeded();
    await page.evaluate(() => { (window as any).scene.forceRender = true; });
    await page.waitForTimeout(100);
    await page.screenshot({ path: 'test-results/attribute-narrow.png' });
    expect(await page.locator('.attribute-panel').evaluate(panel => {
        const bounds = panel.getBoundingClientRect();
        return bounds.right <= innerWidth && [...panel.querySelectorAll('*')].every(e => {
            const r = e.getBoundingClientRect(); return r.width === 0 || r.right <= bounds.right + 1;
        });
    })).toBeTruthy();
    expect(errors).toEqual([]);
});
