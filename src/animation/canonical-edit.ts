/** Column-major affine arithmetic stays double precision until GPU upload. */
const multiplyAffine = (a: ArrayLike<number>, b: ArrayLike<number>): Float64Array => {
    const result = new Float64Array(16);
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            for (let k = 0; k < 4; k++) result[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
        }
    }
    return result;
};

const inverseRigid = (matrix: ArrayLike<number>): Float64Array => {
    const result = new Float64Array(16);
    result[15] = 1;
    for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) result[col * 4 + row] = matrix[row * 4 + col];
    for (let row = 0; row < 3; row++) {
        result[12 + row] = -(result[row] * matrix[12] + result[4 + row] * matrix[13] + result[8 + row] * matrix[14]);
    }
    return result;
};

const conjugateEdit = (deformation: ArrayLike<number>, edit: ArrayLike<number>, canonical: ArrayLike<number>): Float64Array => multiplyAffine(multiplyAffine(inverseRigid(deformation), edit), multiplyAffine(deformation, canonical));

export { multiplyAffine, inverseRigid, conjugateEdit };
