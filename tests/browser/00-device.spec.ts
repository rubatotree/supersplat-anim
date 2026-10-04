import { expect, test } from '@playwright/test';

test('WebGPU adapter and readback are available before application regressions', async ({ page }) => {
    await page.goto('/fixtures/conformance/scene.json');
    const adapter = await page.evaluate(async () => {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error('No WebGPU adapter');
        const device = await adapter.requestDevice();
        const source = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
        const target = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        device.queue.writeBuffer(source, 0, new Uint32Array([42]));
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(source, 0, target, 0, 4);
        device.queue.submit([encoder.finish()]);
        await target.mapAsync(GPUMapMode.READ);
        const value = new Uint32Array(target.getMappedRange())[0];
        target.unmap(); source.destroy(); target.destroy();
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64; document.body.append(canvas);
        const context = canvas.getContext('webgpu');
        context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
        const texture = context.getCurrentTexture();
        const pixels = device.createBuffer({ size: 64 * 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const render = device.createCommandEncoder();
        const pass = render.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store',
            clearValue: { r: 0.25, g: 0.5, b: 0.75, a: 1 } }] });
        pass.end();
        render.copyTextureToBuffer({ texture }, { buffer: pixels, bytesPerRow: 256 }, [64, 64]);
        device.queue.submit([render.finish()]);
        await pixels.mapAsync(GPUMapMode.READ);
        const alpha = new Uint8Array(pixels.getMappedRange())[3];
        pixels.unmap(); pixels.destroy(); context.unconfigure(); device.destroy();
        return { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
            fallback: adapter.info.isFallbackAdapter, value, alpha };
    });
    console.log('WebGPU adapter preflight', adapter);
    expect(adapter.value).toBe(42);
    expect(adapter.alpha).toBe(255);
    if (process.env.BGS_WEBGPU_SOFTWARE === '1') expect(adapter.architecture).toBe('swiftshader');
});
