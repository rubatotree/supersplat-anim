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
