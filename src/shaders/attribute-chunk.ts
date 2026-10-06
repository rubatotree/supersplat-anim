// 色标在 CPU/UI 与 GPU 上共用同一组采样点。
const COLORMAP_STOPS = [
    [[0.267, 0.005, 0.329], [0.283, 0.141, 0.458], [0.254, 0.265, 0.530], [0.207, 0.372, 0.553], [0.164, 0.471, 0.558], [0.128, 0.567, 0.551], [0.135, 0.659, 0.518], [0.267, 0.749, 0.441], [0.478, 0.821, 0.318], [0.741, 0.873, 0.150], [0.993, 0.906, 0.144]],
    [[0.190, 0.072, 0.232], [0.251, 0.253, 0.633], [0.276, 0.477, 0.955], [0.153, 0.680, 0.866], [0.122, 0.843, 0.535], [0.638, 0.991, 0.236], [0.883, 0.866, 0.217], [0.996, 0.644, 0.191], [0.941, 0.356, 0.071], [0.765, 0.144, 0.010], [0.480, 0.016, 0.011]],
    [[0.001, 0.000, 0.014], [0.087, 0.045, 0.225], [0.258, 0.039, 0.406], [0.416, 0.090, 0.433], [0.578, 0.148, 0.404], [0.735, 0.216, 0.330], [0.865, 0.317, 0.226], [0.955, 0.469, 0.100], [0.988, 0.645, 0.040], [0.964, 0.843, 0.273], [0.988, 0.998, 0.645]]
];

const attributeWGSL = /* wgsl */`
fn finiteValue(v: f32) -> bool { return abs(v) <= 3.402823e38; }
fn orderedFloat(v: f32) -> u32 {
    let b = bitcast<u32>(v);
    return select(~b, b ^ 0x80000000u, (b & 0x80000000u) == 0u);
}
fn unorderedFloat(b: u32) -> f32 {
    return bitcast<f32>(select(~b, b ^ 0x80000000u, (b & 0x80000000u) != 0u));
}
fn attributeValue(mode: u32, uv: vec2i, depth: f32, alpha: f32) -> f32 {
    if (mode == 1u) { return depth; }
    if (mode == 4u) { return alpha; }
    return textureLoad(attributeData, uv, 0).x;
}
fn attributeMap(v: f32, lo: f32, hi: f32, map: u32) -> vec3f {
    if (!finiteValue(v)) { return vec3f(0.5); }
    let t = select(0.5, clamp((v - lo) / max(hi - lo, 1e-30), 0.0, 1.0), hi > lo);
    if (map == 3u) { return vec3f(t); }
    var stops: array<vec3f, 11>;
    ${COLORMAP_STOPS.map((stops, i) => `if (map == ${i}u) { stops = array<vec3f, 11>(${stops.map(c => `vec3f(${c.join(',')})`).join(',')}); }`).join('\n    ')}
    let x = t * 10.0;
    let i = u32(min(x, 9.0));
    return mix(stops[i], stops[i + 1u], x - f32(i));
}

// Jacobi 特征分解处理非均匀缩放与剪切后的世界空间协方差。
fn shortestAxis(basis: mat3x3f) -> vec3f {
    let lengths = vec3f(dot(basis[0],basis[0]),dot(basis[1],basis[1]),dot(basis[2],basis[2]));
    let largest = max(max(lengths.x,lengths.y),lengths.z);
    let products = vec3f(dot(basis[0],basis[1]),dot(basis[0],basis[2]),dot(basis[1],basis[2]));
    if (all(lengths > vec3f(1e-30)) && all(abs(products) <= vec3f(largest*1e-6))) {
        if (max(max(abs(lengths.x-lengths.y),abs(lengths.x-lengths.z)),abs(lengths.y-lengths.z)) <= largest*1e-6) { return vec3f(1,0,0); }
        var index = 0u;
        if (lengths.y < lengths.x) { index = 1u; }
        if (lengths.z < lengths[index]) { index = 2u; }
        return normalize(basis[index]);
    }
    var covariance = basis * transpose(basis);
    var vectors = mat3x3f(vec3f(1,0,0), vec3f(0,1,0), vec3f(0,0,1));
    let magnitude = max(max(covariance[0].x, covariance[1].y), covariance[2].z);
    for (var sweep = 0u; sweep < 12u; sweep++) {
        for (var pair = 0u; pair < 3u; pair++) {
            let p = select(0u, 1u, pair == 2u);
            let r = select(2u, 1u, pair == 0u);
            let off = covariance[r][p];
            if (abs(off) <= max(magnitude * 1e-7, 1e-30)) { continue; }
            let tau = (covariance[r][r] - covariance[p][p]) / (2.0 * off);
            let t = select(-1.0, 1.0, tau >= 0.0) / (abs(tau) + sqrt(1.0 + tau*tau));
            let c = inverseSqrt(1.0 + t*t); let s = t*c;
            covariance[p][p] -= t*off; covariance[r][r] += t*off;
            covariance[p][r] = 0.0; covariance[r][p] = 0.0;
            for (var k = 0u; k < 3u; k++) {
                if (k != p && k != r) {
                    let ap = covariance[p][k]; let ar = covariance[r][k];
                    covariance[p][k] = c*ap-s*ar; covariance[k][p] = c*ap-s*ar;
                    covariance[r][k] = s*ap+c*ar; covariance[k][r] = s*ap+c*ar;
                }
                let vp = vectors[p][k]; let vr = vectors[r][k];
                vectors[p][k] = c*vp-s*vr; vectors[r][k] = s*vp+c*vr;
            }
        }
    }
    let values = vec3f(covariance[0].x, covariance[1].y, covariance[2].z);
    var axis = 0u;
    if (values.y < values.x) { axis = 1u; }
    if (values.z < values[axis]) { axis = 2u; }
    return normalize(vectors[axis]);
}
fn attributeNormal(uv: vec2i, model: mat4x4f, rotation: mat3x3f, scale: vec3f, toCamera: vec3f) -> vec3f {
    let authored = textureLoad(attributeData, uv, 0).xyz;
    let authoredMagnitude = max(max(abs(authored.x),abs(authored.y)),abs(authored.z));
    let linear = mat3x3f(model[0].xyz, model[1].xyz, model[2].xyz);
    let determinant = dot(linear[0], cross(linear[1], linear[2]));
    if (all(abs(authored) <= vec3f(3.402823e38)) && authoredMagnitude > 1e-20 && abs(determinant) > 1e-20) {
        let cofactors = mat3x3f(cross(linear[1], linear[2]), cross(linear[2], linear[0]), cross(linear[0], linear[1]));
        return normalize(cofactors * normalize(authored / authoredMagnitude) / determinant);
    }
    let basis = linear * rotation * mat3x3f(vec3f(scale.x,0,0),vec3f(0,scale.y,0),vec3f(0,0,scale.z));
    var n = shortestAxis(basis);
    if (dot(n, toCamera) < 0.0) { n = -n; }
    return n;
}
`;

export { attributeWGSL, COLORMAP_STOPS };
