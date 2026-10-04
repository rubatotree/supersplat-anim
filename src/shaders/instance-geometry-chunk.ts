/** All geometry consumers use the same instance-space transform after posing. */
const instanceGeometryWGSL = /* wgsl */`
fn hasAnimation() -> bool { return textureDimensions(posedTransforms).x > 1u; }
fn posedCoord(instance: u32) -> vec2i {
    let perRow = textureDimensions(posedTransforms).x / 4u;
    return vec2i(i32(instance % perRow) * 4, i32(instance / perRow));
}
fn instanceMatrix(instance: u32, paletteIndex: u32) -> mat4x4f {
    if (!hasAnimation()) { return paletteMatrix(paletteIndex); }
    let uv = posedCoord(instance);
    let a = textureLoad(posedTransforms, uv, 0);
    let b = textureLoad(posedTransforms, uv + vec2i(1, 0), 0);
    let c = textureLoad(posedTransforms, uv + vec2i(2, 0), 0);
    return mat4x4f(vec4f(a.x, b.x, c.x, 0.0), vec4f(a.y, b.y, c.y, 0.0),
        vec4f(a.z, b.z, c.z, 0.0), vec4f(a.w, b.w, c.w, 1.0));
}
fn bindingColor(instance: u32) -> vec3f {
    return textureLoad(posedTransforms, posedCoord(instance) + vec2i(3, 0), 0).rgb;
}`;

export { instanceGeometryWGSL };
