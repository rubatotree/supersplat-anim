import { MemoryReadFileSystem, ZipFileSystem, type FileSystem } from '@playcanvas/splat-transform';

import { dcDecode, dcEncode } from '../color-grade';
import { ColorGradeCache } from '../color-grade-cache';
import type { Splat } from '../splat';
import { loadBgs } from './bgs-loader';
import { BgsProvider } from './bgs-provider';
import { covarianceAxes } from './covariance';
import { gaussianCovariance, transformCovariance } from './math';
import { writeBytes } from './project-animation';

const digest = async (bytes: Uint8Array): Promise<string> => {
    const hash = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
    return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
};

/** Standard BGS export stays in asset coordinates. Editor layer placement is a project concern. */
const createBgsExport = async (splat: Splat, bakeLayerTransform = false): Promise<Map<string, Uint8Array>> => {
    const animation = splat?.animation;
    if (!animation) throw new Error('Select one animated layer for BGS export');
    if (bakeLayerTransform) throw new Error('Baking editor layer placement into standard BGS is not supported; save ssproj or export a static snapshot');
    const { instances } = splat;
    if (!instances.count) throw new Error('Cannot export an empty BGS layer');
    const { data } = animation.provider;
    const g = data.gaussians;
    const header = new TextDecoder().decode(g.bytes.subarray(0, g.headerBytes)).replace(/element vertex \d+/, `element vertex ${instances.count}`);
    const headerBytes = new TextEncoder().encode(header);
    const bytes = new Uint8Array(headerBytes.length + g.stride * instances.count);
    bytes.set(headerBytes);
    const view = new DataView(bytes.buffer);
    const sourceView = new DataView(g.bytes.buffer, g.bytes.byteOffset, g.bytes.byteLength);
    const properties = new Map(g.properties.map(property => [property.name, property]));
    const read = (row: number, name: string): number => sourceView.getFloat32(g.headerBytes + row * g.stride + properties.get(name).offset, true);
    const write = (row: number, name: string, value: number): void => {
        if (!Number.isFinite(Math.fround(value))) throw new Error(`Edited ${name} cannot be represented as finite float32 in BGS`);
        view.setFloat32(headerBytes.length + row * g.stride + properties.get(name).offset, value, true);
    };
    const canonical = new Float64Array(16);
    const covariance = new Float64Array(9);
    const grades = new ColorGradeCache(splat);
    for (let instance = 0; instance < instances.count; instance++) {
        const row = animation.sourceRows[instances.sourceRow[instance]];
        bytes.set(g.bytes.subarray(g.headerBytes + row * g.stride, g.headerBytes + (row + 1) * g.stride), headerBytes.length + instance * g.stride);
        animation.readCanonical(instance, canonical);
        const identity = canonical.every((value, i) => value === (i % 5 === 0 ? 1 : 0));
        if (!identity) {
            for (let axis = 0; axis < 3; axis++) {
                const mean = canonical[axis] * g.positions[row * 3] + canonical[4 + axis] * g.positions[row * 3 + 1] +
                    canonical[8 + axis] * g.positions[row * 3 + 2] + canonical[12 + axis];
                write(instance, ['x', 'y', 'z'][axis], mean);
            }
            transformCovariance(canonical, gaussianCovariance(Array.from(g.rotations.subarray(row * 4, row * 4 + 4)),
                Array.from(g.logScales.subarray(row * 3, row * 3 + 3))), covariance);
            const axes = covarianceAxes(covariance);
            [axes.rotation[3], ...axes.rotation.slice(0, 3)].forEach((value, k) => write(instance, `rot_${k}`, value));
            axes.logScales.forEach((value, k) => write(instance, `scale_${k}`, value));
        }
        const grade = grades.get(instance);
        if (grade.hasTransparency) write(instance, 'opacity', grade.applyOpacity(read(row, 'opacity')));
        if (grade.hasTint) {
            const color = { r: dcDecode(read(row, 'f_dc_0')), g: dcDecode(read(row, 'f_dc_1')), b: dcDecode(read(row, 'f_dc_2')) };
            grade.applyDC(color);
            [color.r, color.g, color.b].forEach((value, k) => write(instance, `f_dc_${k}`, dcEncode(value)));
            const coeffs = ((data.scene.gaussians.sh_degree + 1) ** 2 - 1);
            for (let coefficient = 0; coefficient < coeffs; coefficient++) {
                color.r = read(row, `f_rest_${coefficient}`);
                color.g = read(row, `f_rest_${coeffs + coefficient}`);
                color.b = read(row, `f_rest_${coeffs * 2 + coefficient}`);
                grade.applySH(color);
                [color.r, color.g, color.b].forEach((value, k) => write(instance, `f_rest_${k * coeffs + coefficient}`, value));
            }
        }
    }
    const scene = structuredClone(data.scene);
    scene.asset.id = crypto.randomUUID();
    scene.asset.extras = { ...scene.asset.extras, supersplat_export: { source_asset_id: data.scene.asset.id, layer_placement: 'ssproj_only' } };
    scene.gaussians.uri = 'gaussians.ply';
    scene.gaussians.count = instances.count;
    scene.animation.uri = 'animation.bin';
    const files = new Map<string, Uint8Array>([
        ['scene.json', new TextEncoder().encode(JSON.stringify(scene, null, 2))],
        ['gaussians.ply', bytes], ['animation.bin', data.animationBytes.slice()]
    ]);
    // Validate the actual written bytes, then sample the edited source and the re-import.
    const fs = new MemoryReadFileSystem();
    files.forEach((value, name) => fs.set(name, value));
    const loaded = await loadBgs(fs, 'scene.json');
    if (JSON.stringify(loaded.scene.nodes) !== JSON.stringify(data.scene.nodes) ||
        JSON.stringify(loaded.scene.animation.clips) !== JSON.stringify(data.scene.animation.clips)) throw new Error('Export node/clip mismatch');
    const changedGeometry = new Set(['x', 'y', 'z', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'scale_0', 'scale_1', 'scale_2']);
    for (let instance = 0; instance < instances.count; instance++) {
        const row = animation.sourceRows[instances.sourceRow[instance]];
        if (loaded.gaussians.sourceIds[instance] !== g.sourceIds[row]) throw new Error('Export source ID mismatch');
        const grade = grades.get(instance);
        for (const property of g.properties) {
            if (changedGeometry.has(property.name) || property.name === 'opacity' && grade.hasTransparency ||
                grade.hasTint && (property.name.startsWith('f_dc_') || property.name.startsWith('f_rest_'))) continue;
            for (let byte = 0; byte < property.size; byte++) {
                if (bytes[headerBytes.length + instance * g.stride + property.offset + byte] !==
                    g.bytes[g.headerBytes + row * g.stride + property.offset + byte]) throw new Error(`Export attribute mismatch: ${property.name}`);
            }
        }
        if (grade.hasTint) {
            const coeffs = ((data.scene.gaussians.sh_degree + 1) ** 2 - 1);
            for (let coefficient = -1; coefficient < coeffs; coefficient++) {
                const names = coefficient < 0 ? ['f_dc_0', 'f_dc_1', 'f_dc_2'] : [0, 1, 2].map(k => `f_rest_${k * coeffs + coefficient}`);
                const values = names.map(name => read(row, name));
                const color = { r: values[0], g: values[1], b: values[2] };
                if (coefficient < 0) {
                    color.r = dcDecode(color.r); color.g = dcDecode(color.g); color.b = dcDecode(color.b);
                    grade.applyDC(color);
                    color.r = dcEncode(color.r); color.g = dcEncode(color.g); color.b = dcEncode(color.b);
                } else grade.applySH(color);
                [color.r, color.g, color.b].forEach((value, k) => {
                    if (view.getFloat32(headerBytes.length + instance * g.stride + properties.get(names[k]).offset, true) !== Math.fround(value)) {
                        throw new Error(`Export color mismatch: ${names[k]}`);
                    }
                });
            }
        }
    }
    const provider = new BgsProvider(loaded);
    let maxMeanError = 0;
    let maxCovarianceError = 0;
    let samples = 0;
    const output = { position: new Float64Array(3), covariance: new Float64Array(9) };
    const delta = new Float64Array(16);
    const baseCovariance = new Float64Array(9);
    try {
        for (const clip of animation.provider.asset.clips) {
            for (const time of [0, clip.duration * 0.5, clip.duration]) {
                const original = await animation.provider.prepare(clip.id, time, 0);
                const restored = await provider.prepare(clip.id, time, 0);
                const step = Math.max(1, Math.ceil(instances.count / 256));
                for (let instance = 0; instance < instances.count; instance += step) {
                    const row = animation.sourceRows[instances.sourceRow[instance]];
                    animation.readCanonical(instance, canonical);
                    original.readDeformation(row, delta);
                    const base = [0, 1, 2].map(axis => canonical[axis] * g.positions[row * 3] + canonical[4 + axis] * g.positions[row * 3 + 1] + canonical[8 + axis] * g.positions[row * 3 + 2] + canonical[12 + axis]);
                    restored.readGaussian(instance, output);
                    for (let axis = 0; axis < 3; axis++) {
                        const mean = delta[axis] * base[0] + delta[4 + axis] * base[1] + delta[8 + axis] * base[2] + delta[12 + axis];
                        maxMeanError = Math.max(maxMeanError, Math.abs(mean - output.position[axis]));
                    }
                    transformCovariance(canonical, gaussianCovariance(Array.from(g.rotations.subarray(row * 4, row * 4 + 4)),
                        Array.from(g.logScales.subarray(row * 3, row * 3 + 3))), baseCovariance);
                    transformCovariance(delta, baseCovariance, covariance);
                    for (let k = 0; k < 9; k++) maxCovarianceError = Math.max(maxCovarianceError, Math.abs(covariance[k] - output.covariance[k]));
                    samples++;
                }
            }
        }
    } finally {
        provider.dispose();
    }
    if (maxMeanError > 1e-5 || maxCovarianceError > 1e-5) throw new Error(`BGS round-trip precision failed: mean ${maxMeanError}, covariance ${maxCovarianceError}`);
    const outputHashes: Record<string, { bytes: number; sha256: string }> = {};
    for (const [name, value] of files) outputHashes[name] = { bytes: value.length, sha256: await digest(value) };
    const validation = {
        format: scene.format,
        version: scene.version,
        status: 'passed',
        validation_version: 'supersplat-bgs-export-1',
        timestamp: new Date().toISOString(),
        output_files: outputHashes,
        checks: { format: 'passed',
            source_ids_all: 'passed',
            bindings_and_unknown_properties_all: 'passed',
            sh_all: 'passed',
            nodes_and_clips: 'passed',
            animation_samples: samples,
            max_mean_error: maxMeanError,
            max_covariance_error: maxCovarianceError,
            quality_validation: 'not_performed' }
    };
    files.set('validation.json', new TextEncoder().encode(JSON.stringify(validation, null, 2)));
    files.set('README.md', new TextEncoder().encode(`Standard BGS 0.1 export from SuperSplat\n\nSource asset: ${data.scene.asset.id}\nGaussians: ${instances.count}\nClips: ${scene.animation.clips.length}\n\nEditor layer placement is stored by ssproj and is not baked here.\nValidation reports the checks actually performed on these output files.\nVisual/physical quality was not validated by this exporter.\n`));
    const manifest: string[] = [];
    for (const [name, value] of files) manifest.push(`${await digest(value)}  ${name}`);
    files.set('manifest.sha256', new TextEncoder().encode(`${manifest.join('\n')}\n`));
    return files;
};

const writeBgs = async (splat: Splat, filename: string, fs: FileSystem): Promise<void> => {
    const files = await createBgsExport(splat);
    const zip = new ZipFileSystem(await fs.createWriter(filename));
    for (const [name, bytes] of files) await writeBytes(zip, name, bytes);
    await zip.close();
};

export { createBgsExport, writeBgs };
