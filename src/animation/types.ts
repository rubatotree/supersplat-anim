/** Provider-independent fixed-topology animation contracts. Times are seconds. */
type AnimationClip = {
    readonly id: string;
    readonly duration: number;
    readonly sampleTimes: readonly number[];
    readonly sourceFrames?: readonly number[];
    readonly loopDefault: boolean;
};

type AnimationAsset = {
    readonly id: string;
    readonly name: string;
    readonly gaussianCount: number;
    readonly clips: readonly AnimationClip[];
};

type GaussianPose = {
    /** Mean in asset coordinates, xyz. */
    position: Float64Array;
    /** Symmetric covariance, full column-major 3x3. */
    covariance: Float64Array;
};

interface EvaluatedFrame {
    readonly version: number;
    readonly time: number;
    readonly clipId: string;
    readGaussian(sourceRow: number, output: GaussianPose): void;
    /** Optional column-major canonical-to-posed affine transform. */
    readDeformation?(sourceRow: number, output: Float64Array): void;
}

interface DeformationProvider {
    readonly asset: AnimationAsset;
    readonly capabilities: {
        readonly fixedTopology: boolean;
        readonly inverseEdits: boolean;
        readonly bindings: boolean;
    };
    prepare(clipId: string, time: number, version: number, signal?: AbortSignal): Promise<EvaluatedFrame>;
    dispose(): void;
}

type AnimationInstance = {
    provider: DeformationProvider;
    clipId: string;
    bindPose: boolean;
    frame: EvaluatedFrame | null;
};

export type { AnimationAsset, AnimationClip, AnimationInstance, DeformationProvider, EvaluatedFrame, GaussianPose };
