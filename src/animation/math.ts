/** Double-precision CPU reference. Quaternions are XYZW; matrices column-major. */
type RigidPose = { translation: readonly number[]; rotation: readonly number[] };
type DualQuaternion = { real: readonly number[]; dual: readonly number[] };

const dot = (a: readonly number[], b: readonly number[]): number => a.reduce((sum, x, i) => sum + x * b[i], 0);
const normalizeQuat = (q: readonly number[]): number[] => {
    const length = Math.hypot(...q);
    if (q.length !== 4 || !Number.isFinite(length) || length < 1e-8) throw new Error('Invalid quaternion');
    return q.map(x => x / length);
};
const conjugate = (q: readonly number[]): number[] => [-q[0], -q[1], -q[2], q[3]];
const multiplyQuat = (a: readonly number[], b: readonly number[]): number[] => {
    const [x, y, z, w] = a;
    const [bx, by, bz, bw] = b;
    return [w * bx + x * bw + y * bz - z * by, w * by - x * bz + y * bw + z * bx,
        w * bz + x * by - y * bx + z * bw, w * bw - x * bx - y * by - z * bz];
};
const rotate = (q: readonly number[], p: readonly number[]): number[] => {
    const [x, y, z, w] = q;
    const [a, b, c] = p;
    const tx = 2 * (y * c - z * b);
    const ty = 2 * (z * a - x * c);
    const tz = 2 * (x * b - y * a);
    return [a + w * tx + y * tz - z * ty, b + w * ty + z * tx - x * tz, c + w * tz + x * ty - y * tx];
};
const slerp = (a0: readonly number[], b0: readonly number[], t: number): number[] => {
    const a = normalizeQuat(a0);
    let b = normalizeQuat(b0);
    let cosine = dot(a, b);
    if (cosine < 0) {
        b = b.map(x => -x);
        cosine = -cosine;
    }
    if (cosine > 0.9995) return normalizeQuat(a.map((x, i) => x + (b[i] - x) * t));
    const angle = Math.acos(Math.min(1, cosine));
    const wa = Math.sin((1 - t) * angle) / Math.sin(angle);
    const wb = Math.sin(t * angle) / Math.sin(angle);
    return a.map((x, i) => wa * x + wb * b[i]);
};
const identityPose = (): RigidPose => ({ translation: [0, 0, 0], rotation: [0, 0, 0, 1] });
const compose = (a: RigidPose, b: RigidPose): RigidPose => ({
    translation: rotate(a.rotation, b.translation).map((x, i) => x + a.translation[i]),
    rotation: normalizeQuat(multiplyQuat(a.rotation, b.rotation))
});
const inverse = (pose: RigidPose): RigidPose => {
    const rotation = conjugate(pose.rotation);
    return { rotation, translation: rotate(rotation, pose.translation.map(x => -x)) };
};
const toDualQuaternion = (pose: RigidPose): DualQuaternion => ({
    real: pose.rotation,
    dual: multiplyQuat([...pose.translation, 0], pose.rotation).map(x => x * 0.5)
});
const blend = (nodes: ArrayLike<number>, weights: ArrayLike<number>, deltas: readonly DualQuaternion[], epsilon = 1e-8): DualQuaternion & { fallback: boolean; pivot: number } => {
    let pivotSlot = 0;
    for (let i = 1; i < 4; i++) {
        if (weights[i] > weights[pivotSlot] || (weights[i] === weights[pivotSlot] && nodes[i] < nodes[pivotSlot])) pivotSlot = i;
    }
    const pivot = nodes[pivotSlot];
    const real = [0, 0, 0, 0];
    const dual = [0, 0, 0, 0];
    for (let slot = 0; slot < 4; slot++) {
        if (weights[slot] === 0) continue;
        const dq = deltas[nodes[slot]];
        const weight = weights[slot] * (dot(dq.real, deltas[pivot].real) < 0 ? -1 : 1);
        for (let k = 0; k < 4; k++) {
            real[k] += weight * dq.real[k];
            dual[k] += weight * dq.dual[k];
        }
    }
    const length = Math.hypot(...real);
    if (length < epsilon) return { ...deltas[pivot], fallback: true, pivot };
    for (let k = 0; k < 4; k++) {
        real[k] /= length;
        dual[k] /= length;
    }
    const projection = dot(real, dual);
    for (let k = 0; k < 4; k++) dual[k] -= real[k] * projection;
    return { real, dual, fallback: false, pivot };
};
const fromDualQuaternion = (dq: DualQuaternion): RigidPose => ({
    rotation: dq.real,
    translation: multiplyQuat(dq.dual, conjugate(dq.real)).slice(0, 3).map(x => x * 2)
});
const poseMatrix = (pose: RigidPose, output: Float64Array = new Float64Array(16)): Float64Array => {
    const x = rotate(pose.rotation, [1, 0, 0]);
    const y = rotate(pose.rotation, [0, 1, 0]);
    const z = rotate(pose.rotation, [0, 0, 1]);
    output.set([...x, 0, ...y, 0, ...z, 0, ...pose.translation, 1]);
    return output;
};
const transformCovariance = (matrix: ArrayLike<number>, covariance: ArrayLike<number>, output: Float64Array): void => {
    const temp = new Float64Array(9);
    for (let col = 0; col < 3; col++) {
        for (let row = 0; row < 3; row++) {
            for (let k = 0; k < 3; k++) temp[col * 3 + row] += matrix[k * 4 + row] * covariance[col * 3 + k];
        }
    }
    output.fill(0);
    for (let col = 0; col < 3; col++) {
        for (let row = 0; row < 3; row++) {
            for (let k = 0; k < 3; k++) output[col * 3 + row] += temp[k * 3 + row] * matrix[k * 4 + col];
        }
    }
};
const gaussianCovariance = (rotation: readonly number[], logScale: readonly number[]): Float64Array => {
    const basis = poseMatrix({ translation: [0, 0, 0], rotation });
    const diagonal = new Float64Array(9);
    for (let i = 0; i < 3; i++) diagonal[i * 4] = Math.exp(2 * logScale[i]);
    const result = new Float64Array(9);
    transformCovariance(basis, diagonal, result);
    return result;
};

export { blend, compose, conjugate, dot, fromDualQuaternion, gaussianCovariance, identityPose, inverse, multiplyQuat,
    normalizeQuat, poseMatrix, rotate, slerp, toDualQuaternion, transformCovariance };
export type { DualQuaternion, RigidPose };
