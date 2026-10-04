import assert from 'node:assert/strict';
import { test } from 'node:test';

import { covarianceAxes } from '../src/animation/covariance';
import { gaussianCovariance, transformCovariance } from '../src/animation/math';

test('affine covariance diagonalization preserves anisotropy, shear and handedness', () => {
    const base = gaussianCovariance([0.1, 0.2, 0.3, Math.sqrt(0.86)], [-2, -1, -3]);
    for (const scale of [1, 1e-8, 1e8]) {
        const affine = [1.5 * scale, 0.2 * scale, 0, 0, 0.4 * scale, -0.7 * scale, 0.3 * scale, 0, 0, 0.1 * scale, 2 * scale, 0, 0, 0, 0, 1];
        const covariance = new Float64Array(9);
        transformCovariance(affine, base, covariance);
        const axes = covarianceAxes(covariance);
        const restored = gaussianCovariance(axes.rotation, axes.logScales);
        const norm = Math.max(...covariance.map(Math.abs));
        covariance.forEach((value, i) => assert.ok(Math.abs(value - restored[i]) / norm < 1e-12));
    }
    assert.throws(() => covarianceAxes([1, 0, 0, 0, 0, 0, 0, 0, 1]), /Singular/);
});
