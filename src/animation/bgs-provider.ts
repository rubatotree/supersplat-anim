import type { BgsClip, BgsData } from './bgs-types';
import { blend, compose, fromDualQuaternion, gaussianCovariance, identityPose, inverse, normalizeQuat, poseMatrix,
    rotate, slerp, toDualQuaternion, transformCovariance, type DualQuaternion, type RigidPose } from './math';
import type { AnimationAsset, DeformationProvider, EvaluatedFrame, GaussianPose } from './types';

/** Find the last sample at or before t without assuming uniform frame spacing. */
const sampleIndex = (times: readonly number[], time: number): number => {
    let low = 0;
    let high = times.length;
    while (low + 1 < high) {
        const mid = (low + high) >>> 1;
        if (times[mid] <= time) low = mid;
        else high = mid;
    }
    return low;
};
const evaluateNodes = (data: BgsData, clip: BgsClip | null, time: number): RigidPose[] => {
    if (!clip) return data.bindGlobals;
    const t = Math.max(0, Math.min(clip.duration_seconds, time));
    const low = sampleIndex(clip.times_seconds, t);
    const high = clip.interpolation === 'step' ? low : Math.min(low + 1, clip.frame_count - 1);
    const amount = high === low ? 0 : Math.max(0, Math.min(1, (t - clip.times_seconds[low]) / (clip.times_seconds[high] - clip.times_seconds[low])));
    const view = new DataView(data.animationBytes.buffer, data.animationBytes.byteOffset, data.animationBytes.byteLength);
    const read = (frame: number, node: number): RigidPose => {
        const offset = clip.byte_offset + (frame * clip.node_count + node) * 28;
        return {
            translation: [0, 1, 2].map(k => view.getFloat32(offset + k * 4, true)),
            rotation: normalizeQuat([3, 4, 5, 6].map(k => view.getFloat32(offset + k * 4, true)))
        };
    };
    const globals: RigidPose[] = [];
    data.scene.nodes.forEach((node, index) => {
        const a = read(low, index);
        const b = high === low ? a : read(high, index);
        const local = {
            translation: a.translation.map((x, k) => x + (b.translation[k] - x) * amount),
            rotation: slerp(a.rotation, b.rotation, amount)
        };
        globals.push(index === 0 ? identityPose() : compose(globals[node.parent], local));
    });
    return globals;
};

class BgsFrame implements EvaluatedFrame {
    readonly deltas: readonly DualQuaternion[];
    readonly globals: readonly RigidPose[];

    constructor(readonly data: BgsData, readonly clipId: string, readonly time: number, readonly version: number, clip: BgsClip | null) {
        this.globals = evaluateNodes(data, clip, time);
        this.deltas = this.globals.map((pose, i) => toDualQuaternion(compose(pose, inverse(data.bindGlobals[i]))));
    }

    dualQuaternion(sourceRow: number): DualQuaternion & { fallback: boolean; pivot: number } {
        const g = this.data.gaussians;
        if (!Number.isInteger(sourceRow) || sourceRow < 0 || sourceRow >= g.count) throw new RangeError('BGS source row');
        const offset = sourceRow * 4;
        return blend(g.bindNodes.subarray(offset, offset + 4), g.bindWeights.subarray(offset, offset + 4), this.deltas, this.data.scene.skinning.epsilon);
    }

    readDeformation(sourceRow: number, output: Float64Array): void {
        poseMatrix(fromDualQuaternion(this.dualQuaternion(sourceRow)), output);
    }

    readGaussian(sourceRow: number, output: GaussianPose): void {
        const g = this.data.gaussians;
        const pose = fromDualQuaternion(this.dualQuaternion(sourceRow));
        output.position.set(rotate(pose.rotation, Array.from(g.positions.subarray(sourceRow * 3, sourceRow * 3 + 3)))
        .map((x, i) => x + pose.translation[i]));
        const covariance = gaussianCovariance(Array.from(g.rotations.subarray(sourceRow * 4, sourceRow * 4 + 4)),
            Array.from(g.logScales.subarray(sourceRow * 3, sourceRow * 3 + 3)));
        transformCovariance(poseMatrix(pose), covariance, output.covariance);
    }
}

class BgsProvider implements DeformationProvider {
    readonly capabilities = { fixedTopology: true, inverseEdits: true, bindings: true };
    readonly asset: AnimationAsset;
    private disposed = false;

    constructor(readonly data: BgsData) {
        this.asset = {
            id: data.scene.asset.id,
            name: data.scene.asset.name,
            gaussianCount: data.gaussians.count,
            clips: data.scene.animation.clips.map(clip => ({
                id: clip.id,
                duration: clip.duration_seconds,
                sampleTimes: clip.times_seconds,
                sourceFrames: clip.source_frame_indices,
                loopDefault: clip.loop_default
            }))
        };
    }

    async prepare(clipId: string, time: number, version: number, signal?: AbortSignal): Promise<BgsFrame> {
        // Yield once so a replaced request can be cancelled before pose evaluation.
        await Promise.resolve();
        signal?.throwIfAborted();
        if (this.disposed) throw new Error('Animation provider has been disposed');
        if (!Number.isFinite(time)) throw new Error('Invalid animation time');
        const clip = clipId === '__bind__' ? null : this.data.scene.animation.clips.find(c => c.id === clipId);
        if (clip === undefined) throw new Error(`Unknown BGS clip: ${clipId}`);
        return new BgsFrame(this.data, clipId, Math.max(0, Math.min(time, clip?.duration_seconds ?? 0)), version, clip);
    }

    dispose(): void {
        this.disposed = true;
    }
}

export { BgsFrame, BgsProvider, evaluateNodes, sampleIndex };
