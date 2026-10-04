/*
 * BGS v0.1 reference math. No browser, PlayCanvas, or SuperSplat dependency.
 * Scene JSON uses quaternion XYZW; Graphdeco PLY rot_0..3 uses WXYZ.
 * Matrices in JSON are column-major, column-vector transforms.
 */
'use strict';

const EPS = 1e-8;

function v3(x, y, z) { return [x, y, z]; }
function dot3(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function add3(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function scale3(a, s) { return [a[0]*s, a[1]*s, a[2]*s]; }

function qNormalize(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!Number.isFinite(n) || n < EPS) throw new Error('zero or invalid quaternion');
  return q.map(x => x / n);
}
function qConj(q) { return [-q[0], -q[1], -q[2], q[3]]; }
function qDot(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]; }
function qNeg(q) { return q.map(x => -x); }
function qMul(a, b) {
  const [x,y,z,w] = a, [X,Y,Z,W] = b;
  return [w*X+x*W+y*Z-z*Y,
          w*Y-x*Z+y*W+z*X,
          w*Z+x*Y-y*X+z*W,
          w*W-x*X-y*Y-z*Z];
}
function qRotate(q, p) {
  const [x,y,z,w] = q, [a,b,c] = p;
  const tx = 2*(y*c-z*b), ty = 2*(z*a-x*c), tz = 2*(x*b-y*a);
  return [a+w*tx+(y*tz-z*ty), b+w*ty+(z*tx-x*tz), c+w*tz+(x*ty-y*tx)];
}
function qSlerp(a0, b0, u) {
  const a = qNormalize(a0); let b = qNormalize(b0);
  let d = qDot(a,b);
  if (d < 0) { b = qNeg(b); d = -d; }
  d = Math.max(-1, Math.min(1, d));
  if (d > 0.9995) return qNormalize(a.map((x,i)=>x+(b[i]-x)*u));
  const theta = Math.acos(d), s = Math.sin(theta);
  const wa = Math.sin((1-u)*theta)/s, wb = Math.sin(u*theta)/s;
  return a.map((x,i)=>wa*x+wb*b[i]);
}

function identityTransform() { return { translation:[0,0,0], rotation_xyzw:[0,0,0,1] }; }
function normalizeTransform(t) {
  return { translation:t.translation.map(Number), rotation_xyzw:qNormalize(t.rotation_xyzw.map(Number)) };
}
function compose(a0, b0) {
  const a=normalizeTransform(a0), b=normalizeTransform(b0);
  return { translation:add3(a.translation,qRotate(a.rotation_xyzw,b.translation)),
           rotation_xyzw:qNormalize(qMul(a.rotation_xyzw,b.rotation_xyzw)) };
}
function inverse(t0) {
  const t=normalizeTransform(t0), qi=qConj(t.rotation_xyzw);
  return { translation:qRotate(qi,scale3(t.translation,-1)), rotation_xyzw:qi };
}
function transformPoint(t, p) { return add3(qRotate(t.rotation_xyzw,p),t.translation); }

function assertScene(scene) {
  if (!scene || scene.format !== 'bound-gaussian-scene' || scene.version !== '0.1.0')
    throw new Error('unsupported BGS scene/version');
  const nodes=scene.nodes;
  if (!Array.isArray(nodes) || !nodes.length || nodes[0].index !== 0 || nodes[0].parent !== -1 || nodes[0].name !== 'scene')
    throw new Error('node 0 must be the scene root');
  for (let i=0;i<nodes.length;i++) {
    if (nodes[i].index !== i) throw new Error('node indices must equal their array positions');
    const p=nodes[i].parent;
    if (i===0 ? p!==-1 : !(Number.isInteger(p) && p>=0 && p<i))
      throw new Error(`invalid parent order at node ${i}`);
    normalizeTransform(nodes[i].bind_local);
  }
  const root=normalizeTransform(nodes[0].bind_local);
  if (Math.hypot(...root.translation)>1e-6 || Math.abs(Math.abs(root.rotation_xyzw[3])-1)>1e-6)
    throw new Error('scene root bind local must be identity');
}

function bindGlobals(nodes) {
  return globalsFromLocals(nodes,nodes.map(n=>n.bind_local));
}
function globalsFromLocals(nodes, locals) {
  if (nodes.length!==locals.length) throw new Error('node/local count mismatch');
  const out=[];
  for (let i=0;i<nodes.length;i++) out.push(i===0 ? normalizeTransform(locals[i]) : compose(out[nodes[i].parent],locals[i]));
  return out;
}

function decodeFrame(scene, clip, arrayBuffer, frameIndex) {
  const n=scene.nodes.length;
  if (clip.node_count!==n) throw new Error('clip node_count mismatch');
  if (frameIndex<0 || frameIndex>=clip.frame_count) throw new RangeError('frame index');
  const view=new DataView(arrayBuffer), nodeStride=scene.animation.record_stride_bytes || 28;
  const frameStride=clip.frame_stride_bytes || clip.node_count*nodeStride;
  const base=clip.byte_offset+frameIndex*frameStride, out=[];
  for(let i=0;i<n;i++) {
    const o=base+i*nodeStride, x=[];
    for(let k=0;k<7;k++) x.push(view.getFloat32(o+4*k,true));
    out.push({translation:x.slice(0,3),rotation_xyzw:qNormalize(x.slice(3,7))});
  }
  return out;
}
function poseAt(scene, clip, arrayBuffer, timeSeconds, loop=false) {
  assertScene(scene);
  if (!Array.isArray(clip.times_seconds) || clip.times_seconds.length!==clip.frame_count || clip.frame_count<1)
    throw new Error('invalid clip timestamps');
  const times=clip.times_seconds;
  for(let i=1;i<times.length;i++) if(!(times[i]>times[i-1])) throw new Error('timestamps must increase');
  let t=Number(timeSeconds);
  if(!Number.isFinite(t)) throw new Error('invalid time');
  if(loop && clip.duration_seconds>0) t=((t%clip.duration_seconds)+clip.duration_seconds)%clip.duration_seconds;
  t=Math.max(times[0],Math.min(times[times.length-1],t));
  let hi=0;
  while(hi<times.length-1 && times[hi+1]<t) hi++;
  if(hi===times.length-1 || t===times[hi]) return decodeFrame(scene,clip,arrayBuffer,hi);
  const lo=hi, next=hi+1, u=(t-times[lo])/(times[next]-times[lo]);
  const a=decodeFrame(scene,clip,arrayBuffer,lo), b=decodeFrame(scene,clip,arrayBuffer,next);
  const result=a.map((p,i)=>({translation:p.translation.map((x,k)=>x+(b[i].translation[k]-x)*u),
      rotation_xyzw:qSlerp(p.rotation_xyzw,b[i].rotation_xyzw,u)}));
  const root=result[0];
  if(Math.hypot(...root.translation)>1e-5 || Math.abs(Math.abs(root.rotation_xyzw[3])-1)>1e-5)
    throw new Error('node 0 must remain identity in every animation frame');
  return result;
}
function findClip(scene, clipId) {
  const clips=scene?.animation?.clips;
  if(!Array.isArray(clips)) throw new Error('scene.animation.clips is missing');
  const clip=clips.find(x=>x.id===clipId);
  if(!clip) throw new Error(`unknown clip id: ${clipId}`);
  return clip;
}
function poseAtClip(scene, animationBuffer, clipId, timeSeconds, loop) {
  return poseAt(scene,findClip(scene,clipId),animationBuffer,timeSeconds,loop);
}

function dualQuaternionFromTransform(t0) {
  const t=normalizeTransform(t0), real=t.rotation_xyzw;
  const dual=scaleQuat(qMul([t.translation[0],t.translation[1],t.translation[2],0],real),0.5);
  return {real,dual};
}
function scaleQuat(q,s) { return q.map(x=>x*s); }
function dqTranslation(dq) {
  return scaleQuat(qMul(dq.dual,qConj(dq.real)).slice(0,3),2);
}
function dqTransformPoint(dq,p) { return add3(qRotate(dq.real,p),dqTranslation(dq)); }

function deltasFromLocals(scene, poseLocals) {
  const bg=bindGlobals(scene.nodes), pg=globalsFromLocals(scene.nodes,poseLocals);
  return pg.map((g,i)=>dualQuaternionFromTransform(compose(g,inverse(bg[i]))));
}
function blendDualQuaternions(influences, deltas, epsilon=EPS) {
  if(influences.some(x=>!Number.isInteger(x.node)||x.node<0||x.node>=deltas.length||!Number.isFinite(x.weight)||x.weight<0))
    throw new Error('invalid binding influence');
  const xs=influences.filter(x=>x.weight>0).map(x=>({node:x.node,weight:x.weight}));
  if(!xs.length) throw new Error('no positive binding weights');
  if(new Set(xs.map(x=>x.node)).size!==xs.length) throw new Error('duplicate positive nodes must be merged');
  const total=xs.reduce((s,x)=>s+x.weight,0);
  if(!Number.isFinite(total) || total<=0 || Math.abs(total-1)>1e-4) throw new Error('weights must sum to one');
  xs.sort((a,b)=>b.weight-a.weight || a.node-b.node);
  const pivot=deltas[xs[0].node].real;
  let real=[0,0,0,0], dual=[0,0,0,0];
  for(const x of xs) {
    let d=deltas[x.node], sign=qDot(d.real,pivot)<0?-1:1;
    const r=scaleQuat(d.real,sign), qd=scaleQuat(d.dual,sign);
    real=real.map((v,k)=>v+x.weight*r[k]);
    dual=dual.map((v,k)=>v+x.weight*qd[k]);
  }
  const norm=Math.hypot(...real);
  if(norm<epsilon) {
    const d=deltas[xs[0].node];
    return {real:qNormalize(d.real),dual:d.dual.map(x=>x),fallback:true,pivotNode:xs[0].node};
  }
  real=real.map(x=>x/norm); dual=dual.map(x=>x/norm);
  const rd=qDot(real,dual);
  dual=dual.map((x,i)=>x-real[i]*rd);
  return {real,dual,fallback:false,pivotNode:xs[0].node};
}

function plyWxyzToXyzw(q) { return qNormalize([q[1],q[2],q[3],q[0]]); }
function xyzwToPlyWxyz(q) { return [q[3],q[0],q[1],q[2]]; }
function transformGaussian(g, deltas) {
  const dq=blendDualQuaternions(g.influences,deltas);
  return { xyz:dqTransformPoint(dq,g.xyz),
           rotation_xyzw:qNormalize(qMul(dq.real,plyWxyzToXyzw(g.rot_wxyz))),
           scales_log:g.scales_log.slice(),
           dq_fallback:dq.fallback,
           dq_real_dual_dot:qDot(dq.real,dq.dual) };
}

// Graphdeco real SH degree <=2, direction points camera -> Gaussian.
// rest order is l=1 [-1,0,+1], then l=2 [-2,-1,0,+1,+2].
const SH_C0=0.28209479177387814, SH_C1=0.4886025119029199;
const SH_C2=[1.0925484305920792,-1.0925484305920792,0.31539156525252005,-1.0925484305920792,0.5462742152960396];
function shBasis2(d0) {
  const n=Math.hypot(...d0), [x,y,z]=d0.map(v=>v/n);
  return [SH_C0,-SH_C1*y,SH_C1*z,-SH_C1*x,
    SH_C2[0]*x*y,SH_C2[1]*y*z,SH_C2[2]*(2*z*z-x*x-y*y),SH_C2[3]*x*z,SH_C2[4]*(x*x-y*y)];
}
function evalSh2(dc3, rest3x8, direction, clamp=false) {
  const b=shBasis2(direction), out=[];
  for(let c=0;c<3;c++) {
    let x=0.5+dc3[c]*b[0];
    for(let k=0;k<8;k++) x+=rest3x8[c][k]*b[k+1];
    out.push(clamp?Math.max(0,x):x);
  }
  return out;
}

if (typeof module!=='undefined') module.exports={
  EPS,qNormalize,qConj,qDot,qMul,qRotate,qSlerp,identityTransform,compose,inverse,transformPoint,
  assertScene,bindGlobals,globalsFromLocals,decodeFrame,poseAt,findClip,poseAtClip,dualQuaternionFromTransform,
  dqTranslation,dqTransformPoint,deltasFromLocals,blendDualQuaternions,plyWxyzToXyzw,
  xyzwToPlyWxyz,transformGaussian,SH_C0,SH_C1,SH_C2,shBasis2,evalSh2
};
