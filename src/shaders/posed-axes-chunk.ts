const posedAxesWGSL = /* wgsl */`
struct GaussianAxes { scale: vec3f, rotation: vec4f }
fn axesQuaternion(matrix: mat3x3f) -> vec4f {
    var m = matrix;
    if (dot(cross(m[0], m[1]), m[2]) < 0.0) { m[2] = -m[2]; }
    var q: vec4f;
    let trace = m[0].x + m[1].y + m[2].z;
    if (trace > 0.0) {
        let s = sqrt(trace + 1.0) * 2.0;
        q = vec4f((m[1].z-m[2].y)/s, (m[2].x-m[0].z)/s, (m[0].y-m[1].x)/s, s/4.0);
    } else if (m[0].x >= m[1].y && m[0].x >= m[2].z) {
        let s = sqrt(max(0.0, 1.0+m[0].x-m[1].y-m[2].z))*2.0;
        q = vec4f(s/4.0, (m[1].x+m[0].y)/s, (m[2].x+m[0].z)/s, (m[1].z-m[2].y)/s);
    } else if (m[1].y >= m[2].z) {
        let s = sqrt(max(0.0, 1.0+m[1].y-m[0].x-m[2].z))*2.0;
        q = vec4f((m[1].x+m[0].y)/s, s/4.0, (m[2].y+m[1].z)/s, (m[2].x-m[0].z)/s);
    } else {
        let s = sqrt(max(0.0, 1.0+m[2].z-m[0].x-m[1].y))*2.0;
        q = vec4f((m[2].x+m[0].z)/s, (m[2].y+m[1].z)/s, s/4.0, (m[0].y-m[1].x)/s);
    }
    q = normalize(q);
    if (q.w < 0.0) { q = -q; }
    return vec4f(q.w, q.xyz);
}
fn posedAxes(index: u32, uv: vec2i) -> GaussianAxes {
    let a = textureLoad(transformA, uv, 0);
    let b = textureLoad(transformB, uv, 0);
    let xy = unpack2x16float(a.w);
    let q = vec4f(xy, b.w, sqrt(max(0.0, 1.0 - dot(vec3f(xy, b.w), vec3f(xy, b.w)))));
    let qn = normalize(q);
    let x = qn.x; let y = qn.y; let z = qn.z; let w = qn.w;
    let rotation = mat3x3f(vec3f(1.0-2.0*(y*y+z*z), 2.0*(x*y+w*z), 2.0*(x*z-w*y)),
        vec3f(2.0*(x*y-w*z), 1.0-2.0*(x*x+z*z), 2.0*(y*z+w*x)),
        vec3f(2.0*(x*z+w*y), 2.0*(y*z-w*x), 1.0-2.0*(x*x+y*y)));
    let transform = uniforms.entityMatrix * instanceMatrix(index, instancePalette[index] & 0xffffu);
    let basis = mat3x3f(transform[0].xyz, transform[1].xyz, transform[2].xyz) * rotation *
        mat3x3f(vec3f(b.x, 0.0, 0.0), vec3f(0.0, b.y, 0.0), vec3f(0.0, 0.0, b.z));
    let lengths = vec3f(length(basis[0]), length(basis[1]), length(basis[2]));
    // Preserve authored axes when the affine leaves them orthogonal. Otherwise
    // report principal axes of A*Sigma*A^T, rather than a lossy TRS decomposition.
    let products = vec3f(dot(basis[0], basis[1]), dot(basis[0], basis[2]), dot(basis[1], basis[2]));
    let largest = max(max(lengths.x, lengths.y), lengths.z);
    if (all(abs(products) <= vec3f(largest*largest*1e-6)) && all(lengths > vec3f(0.0))) {
        return GaussianAxes(lengths, axesQuaternion(mat3x3f(basis[0]/lengths.x, basis[1]/lengths.y, basis[2]/lengths.z)));
    }
    var covariance = basis * transpose(basis);
    var vectors = mat3x3f(vec3f(1.0,0.0,0.0), vec3f(0.0,1.0,0.0), vec3f(0.0,0.0,1.0));
    let magnitude = max(max(covariance[0].x, covariance[1].y), covariance[2].z);
    for (var sweep = 0u; sweep < 12u; sweep++) {
        for (var pair = 0u; pair < 3u; pair++) {
            let p = select(0u, 1u, pair == 2u);
            let r = select(2u, 1u, pair == 0u);
            let off = covariance[r][p];
            if (abs(off) <= magnitude * 1e-7) { continue; }
            let tau = (covariance[r][r]-covariance[p][p])/(2.0*off);
            let t = select(-1.0, 1.0, tau >= 0.0)/(abs(tau)+sqrt(1.0+tau*tau));
            let c = inverseSqrt(1.0+t*t);
            let s = t*c;
            covariance[p][p] -= t*off;
            covariance[r][r] += t*off;
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
    var values = vec3f(covariance[0].x, covariance[1].y, covariance[2].z);
    for (var i = 0u; i < 2u; i++) {
        for (var j = i+1u; j < 3u; j++) {
            if (values[j] > values[i]) {
                let value = values[i]; values[i] = values[j]; values[j] = value;
                let vector = vectors[i]; vectors[i] = vectors[j]; vectors[j] = vector;
            }
        }
    }
    return GaussianAxes(sqrt(max(values, vec3f(0.0))), axesQuaternion(vectors));
}`;

export { posedAxesWGSL };
