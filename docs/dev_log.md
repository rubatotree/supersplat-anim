# Animation development log

## 2026-10-04 — implementation start

- Base revision: 4d172ca (SuperSplat 3.5.1), branch main, clean working tree.
- Existing pipeline: custom WebGPU projector, immutable chunk sources, shared
  Gaussian resources and editable instance lists; PCUI camera timeline and PLY
  sequence playback already exist.
- Supplied BGS CPU tests: 5/5 passed; conformance validator and manifest passed;
  JavaScript reference self-check passed. No app GPU validation performed yet.
- Production sample: scene.json, gaussians.ply and animation.bin are missing.
- Confirmed behaviour: edits retain bindings; implement native project save,
  static snapshots and standard BGS export; no non-rigid BGS extension.
- Quota: baseline 48% used; latest 49% used. Stop new features at 63% used and
  stop engineering at 68% used. Current reset approximately 2026-10-11 14:29 +08.
- Next: install locked dependencies; implement provider types and timeline
  correctness with deterministic tests, then validate the BGS adapter.

## M1 — provider contract and clock

- Added fixed-topology provider/frame interfaces with optional inverse editing.
- Replaced playback accumulation with a seconds clock; loop=false now stops at
  the endpoint, live scrubbing updates playback, multiplier is independent of fps.
- Kept legacy fractional-frame camera events, validated timeline values and old
  document defaults; scene clear stops playback. Fixed single-frame tick layout
  and the PLY sequence length setter.
- Added TypeScript/node tests and browser test dependency. Four tests, typecheck,
  focused lint and production build passed. Build has pre-existing vendor/Sass warnings.
- Quota checkpoint: 50% remaining (50% used), continue.
- Next: BGS parser, CPU DQ reference and malformed-input tests.

## M2 — BGS validation and CPU provider

- Added strict base-profile JSON/binary/PLY validation, safe relative assets and
  ZIP loader. Raw PLY and property declarations are retained for lossless export.
- Added local-pose interpolation, hierarchy, DQ blending, covariance reference
  and provider cancellation. Bind pose is distinct from the first clip sample.
- Thirteen tests pass, including an independent supplied JS oracle, SH rotation,
  malformed data and filesystem loading. Typecheck and focused lint pass.
- Real package arrived: 350k Gaussians, 10 nodes, two clips, 359 samples total.
  It is an experimental one-hot B binding; release motion and calibrated quality
  must not be claimed. App/GPU validation is still pending.
- Quota checkpoint: 49% remaining, continue.
- Next: shared GPU matrix path and import into the editor.
