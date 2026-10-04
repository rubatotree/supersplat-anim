/** Symmetric Jacobi eigensolver. Keeps the full affine covariance, including shear. */
const covarianceAxes = (covariance: ArrayLike<number>): { rotation: number[]; logScales: number[] } => {
    const a = Float64Array.from(covariance);
    const vectors = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const scale = Math.max(Math.abs(a[0]), Math.abs(a[4]), Math.abs(a[8]));
    if (!Number.isFinite(scale) || scale <= 0) throw new Error('Covariance cannot be represented by finite positive Gaussian scales');
    for (let sweep = 0; sweep < 16; sweep++) {
        let largest = 0;
        for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
            const off = a[q * 3 + p];
            largest = Math.max(largest, Math.abs(off));
            if (Math.abs(off) <= scale * 1e-15) continue;
            const tau = (a[q * 3 + q] - a[p * 3 + p]) / (2 * off);
            const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.hypot(1, tau));
            const c = 1 / Math.hypot(1, t);
            const s = t * c;
            a[p * 3 + p] -= t * off;
            a[q * 3 + q] += t * off;
            a[q * 3 + p] = a[p * 3 + q] = 0;
            for (let k = 0; k < 3; k++) {
                if (k !== p && k !== q) {
                    const ap = a[p * 3 + k];
                    const aq = a[q * 3 + k];
                    a[p * 3 + k] = a[k * 3 + p] = c * ap - s * aq;
                    a[q * 3 + k] = a[k * 3 + q] = s * ap + c * aq;
                }
                const vp = vectors[p * 3 + k];
                const vq = vectors[q * 3 + k];
                vectors[p * 3 + k] = c * vp - s * vq;
                vectors[q * 3 + k] = s * vp + c * vq;
            }
        }
        if (largest <= scale * 1e-15) break;
    }
    const order = [0, 1, 2].sort((p, q) => a[q * 3 + q] - a[p * 3 + p] || p - q);
    const rotationMatrix = new Float64Array(9);
    const logScales = order.map((index, col) => {
        const eigenvalue = a[index * 3 + index];
        if (!(eigenvalue > 0)) throw new Error('Singular covariance cannot be written as finite BGS scales');
        rotationMatrix.set(vectors.subarray(index * 3, index * 3 + 3), col * 3);
        return Math.log(eigenvalue) * 0.5;
    });
    const m = rotationMatrix;
    const determinant = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[3] * (m[1] * m[8] - m[2] * m[7]) + m[6] * (m[1] * m[5] - m[2] * m[4]);
    if (determinant < 0) for (let k = 6; k < 9; k++) m[k] = -m[k];
    const trace = m[0] + m[4] + m[8];
    let rotation: number[];
    if (trace > 0) {
        const s = Math.sqrt(trace + 1) * 2;
        rotation = [(m[5] - m[7]) / s, (m[6] - m[2]) / s, (m[1] - m[3]) / s, s / 4];
    } else {
        const i = [0, 1, 2].sort((p, q) => m[q * 3 + q] - m[p * 3 + p])[0];
        const j = (i + 1) % 3;
        const k = (i + 2) % 3;
        const s = Math.sqrt(1 + m[i * 3 + i] - m[j * 3 + j] - m[k * 3 + k]) * 2;
        rotation = [0, 0, 0, 0];
        rotation[i] = s / 4;
        rotation[j] = (m[j * 3 + i] + m[i * 3 + j]) / s;
        rotation[k] = (m[k * 3 + i] + m[i * 3 + k]) / s;
        rotation[3] = (m[j * 3 + k] - m[k * 3 + j]) / s;
    }
    if (rotation[3] < 0) rotation = rotation.map(value => -value);
    return { rotation, logScales };
};

export { covarianceAxes };
