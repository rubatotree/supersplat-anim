import assert from 'node:assert/strict';
import { test } from 'node:test';

import { conjugateEdit, inverseRigid, multiplyAffine } from '../src/animation/canonical-edit';
import { poseMatrix, transformCovariance } from '../src/animation/math';

test('current-pose affine editing commutes with canonical inverse mapping', () => {
    const deformation = poseMatrix({ translation: [0.2, -0.6, 0.4], rotation: [0, Math.sin(0.6), 0, Math.cos(0.6)] });
    const edit = new Float64Array([2, 0.2, 0, 0, 0, 0.5, 0, 0, 0, 0, 1.5, 0, -0.3, 0.7, 0.1, 1]);
    const old = poseMatrix({ translation: [1, 2, 3], rotation: [0, 0, 0, 1] });
    const canonical = conjugateEdit(deformation, edit, old);
    const actual = multiplyAffine(deformation, canonical);
    const expected = multiplyAffine(edit, multiplyAffine(deformation, old));
    actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-12));
    const identity = multiplyAffine(inverseRigid(deformation), deformation);
    identity.forEach((value, i) => assert.ok(Math.abs(value - (i % 5 === 0 ? 1 : 0)) < 1e-12));
    const covariance = new Float64Array([1, 0, 0, 0, 0.1, 0, 0, 0, 0.3]);
    const a = new Float64Array(9);
    const b = new Float64Array(9);
    transformCovariance(actual, covariance, a);
    transformCovariance(expected, covariance, b);
    a.forEach((value, i) => assert.ok(Math.abs(value - b[i]) < 1e-12));
});
