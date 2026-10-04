import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/browser',
    workers: 1,
    reporter: 'list',
    maxFailures: process.env.CI ? 1 : 0,
    timeout: 120000,
    use: {
        baseURL: 'http://127.0.0.1:4173',
        viewport: { width: 1280, height: 720 },
        launchOptions: { args: process.env.BGS_WEBGPU_SOFTWARE === '1' ?
            ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
                '--enable-unsafe-swiftshader', '--use-vulkan=swiftshader',
                '--enable-features=Vulkan', '--disable-vulkan-surface', '--ignore-gpu-blocklist',
                '--enable-gpu-rasterization', '--enable-accelerated-2d-canvas'] :
            ['--enable-unsafe-webgpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface'] }
    },
    webServer: { command: 'node tests/browser/server.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: true }
});
