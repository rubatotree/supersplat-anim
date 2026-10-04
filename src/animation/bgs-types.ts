import type { RigidPose } from './math';

type BgsNode = {
    index: number;
    name: string;
    parent: number;
    bind_local: { translation: number[]; rotation_xyzw: number[] };
    inverse_bind_matrix: number[];
    extras?: Record<string, unknown>;
};
type BgsClip = {
    id: string;
    frame_count: number;
    node_count: number;
    byte_offset: number;
    byte_length: number;
    times_seconds: number[];
    duration_seconds: number;
    interpolation: 'step' | 'linear_translation_slerp_rotation';
    loop_default: boolean;
    source_frame_indices?: number[];
    extras?: Record<string, unknown>;
};
type BgsScene = {
    format: 'bound-gaussian-scene';
    version: '0.1.0';
    asset: { id: string; name: string; quality_status: string; extras?: Record<string, unknown> };
    coordinate_system: Record<string, any>;
    gaussians: Record<string, any> & { uri: string; count: number; sh_degree: number };
    nodes: BgsNode[];
    skinning: { method: 'dual_quaternion'; epsilon: number; near_zero_fallback: 'dominant_influence' };
    animation: Record<string, any> & { uri: string; clips: BgsClip[] };
    normalization: Record<string, any>;
    cameras: Record<string, any>[];
    extensions_required: string[];
    extras?: Record<string, unknown>;
};
type PlyProperty = { name: string; type: string; offset: number; size: number };
type BgsGaussians = {
    count: number;
    bytes: Uint8Array;
    headerBytes: number;
    stride: number;
    properties: PlyProperty[];
    positions: Float64Array;
    rotations: Float64Array;
    logScales: Float64Array;
    sourceIds: Uint32Array;
    bindNodes: Uint32Array;
    bindWeights: Float32Array;
    dominantNodes: Uint32Array;
};
type BgsData = {
    scene: BgsScene;
    gaussians: BgsGaussians;
    animationBytes: Uint8Array;
    bindGlobals: RigidPose[];
};

export type { BgsClip, BgsData, BgsGaussians, BgsNode, BgsScene, PlyProperty };
