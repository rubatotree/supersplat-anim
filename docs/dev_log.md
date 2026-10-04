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

## M3 — shared GPU deformation

- BGS DQ compute writes a provider-neutral affine atlas. Projector, bounds,
  volume/screen selection and data/color computations consume the same atlas.
- Pose and reduced bounds publish together using double buffering; stale
  requests are invalidated. GPU fallback counter is exposed per evaluated frame.
- Added local directory/multifile, ZIP and URL imports with strict local missing
  resource errors. Morton resource rows map back to immutable BGS source rows.
- Video frame preparation waits for exact seconds; scene-frame SH directions
  use the layer inverse without rotating SH by animated node transforms.
- Typecheck, focused lint, debug build and 3 Playwright WebGPU tests passed.
  Synthetic five-point matrix error: 2.24e-8; real 350k scene, both clips,
  704 deterministic row samples: maximum matrix error 8.41e-8. GPU property
  packing error is not included in these numbers. Static PLY path passed.
- A real-scene screenshot was visually inspected. Adapter description was blank;
  no hardware performance claim is made until adapter identity is confirmed.
- Remaining: UI, canonical editing/layer sharing, project persistence, posed
  covariance inspector/snapshots, standard BGS export and full tool regressions.
- Quota checkpoint: 49% remaining, continue.

## M4 — animation timeline and binding preview

- Added native PCUI layer/clip selection, independent playback multiplier, seconds,
  sample/source-frame labels and distinct bind-pose control. Animation import
  opens the timeline; controls wrap in narrow windows.
- Added stable dominant-node preview colors, a matching node legend, asset-axis
  description and single-selection stable-ID/four-slot inspector. Colors remain
  preview-only, preserve lock/selection feedback and yield to Overdraw.
- Added English/Chinese strings; remaining locales retain complete English
  fallback entries according to the locale key checker.
- Typecheck, focused lint, 402-key locale check and four WebGPU browser tests
  pass; the 640px control layout screenshot was visually inspected.
- Quota checkpoint: 48% remaining. Next: canonical per-instance affine editing.

## M5 — bound editing and instance lifecycle

- Added lazy double-precision per-instance canonical affine storage, independent
  of the 16-bit static transform palette. Untouched layers share the identity.
- GPU drag preview applies U*D*C; gesture completion conjugates U through each
  frozen D. History records actual instance indices and before/after matrices.
- Tool/selection/history interaction freezes playback and invalidates pending
  poses. Delete/restore, duplicate and separate maintain matrices and row mapping;
  layers share immutable BGS assets and create separate provider lifetimes.
- Empty-instance bounds now return a finite zero extent. Full covariance stays
  affine in the projector; posed scalar/covariance inspection remains to finish.
- 14 unit tests, typecheck, focused lint, debug build and 5 WebGPU tests pass,
  including non-bind affine edit, later-time undo/redo, edited GPU/CPU matrix
  comparison, shared duplication, deletion/restoration and separation/undo.
- Quota checkpoint: 48% remaining. Next: project version 2 persistence.

## M6 — native project persistence

- Project version 2 stores immutable BGS files once per shared asset, resource
  row mapping, clip/bind-pose state, preview coloring and float64 affine sidecars.
  Version 0/1 reading remains supported; unknown future versions are rejected.
- Animated resources keep all canonical rows in project saves so restoring
  missing instances retains their original geometry and bindings. Layer edits
  and placement remain independent; duplicate layers share both resource/data.
- Saves freeze playback and wait for queued edits. Load validates binary mapping
  and affine sidecars and waits for the restored timeline's evaluated pose.
- 15 unit tests, typecheck, focused lint, debug build and 6 WebGPU tests pass.
  Browser save/download/reopen preserved shared assets, edits, stable IDs,
  timeline time/rate and binding preview state.
- Quota checkpoint: 48% remaining. Next: posed exports and standard BGS round trip.

## M7 — posed snapshots and standard BGS export

- Static writers now resolve animated per-instance matrices and diagonalize
  full affine covariance. SH rebase uses only the scene/layer coordinate change,
  shared once per layer; animation/canonical edits do not rotate scene-frame SH.
- Image and video preparation wait for the requested pose. Export dialog labels
  static snapshots; viewer camera tracks do not imply Gaussian animation.
- Added selected-layer .bgs.zip export in asset coordinates, preserving typed
  unknown properties, IDs, all binding slots, nodes, clips and provenance.
  Generated files get a new asset ID, new validation.json and SHA-256 manifest.
- Actual output is reloaded and checked: all IDs/bindings/untouched properties/SH,
  node/clip equality and up to 256 rows at three times in every clip. Quality
  validation is explicitly not claimed. Unsupported placement baking and singular
  BGS covariances fail; static SH snapshots reject non-uniform/sheared layer placement.
- 17 unit tests, typecheck, focused lint, 405-key locale check, debug build and
  7 WebGPU tests passed. Snapshot re-import means/covariances match the edited pose.
  The exported BGS also passed the independent supplied validate.py with manifest.
- Test readback arrays were bounded to live rows; re-running the snapshot test
  took 4.2s after avoiding serialization of oversized pooled buffers.
- Quota checkpoint: 47% remaining. Next: complete posed data inspection, regression
  coverage, GPU identity/performance and real-scene acceptance evidence.

## Shared pose and lifecycle corrections

- Posed scale/quaternion data queries now recover full affine covariance using
  GPU principal axes when needed. Measured relative covariance error on packed
  GPU data is 1.6042e-5; this is separate from the CPU double-precision oracle.
- Layer poses and bounds publish together. Rapid seeks discard superseded work;
  ordinary playback coalesces queued times without cancelling every in-flight
  GPU reduction. Stress measurements exposed that cancellation starvation and
  the real scene now commits about 46 poses/s (final report to follow).
- Selection function entries, depth picking, focus, color edits and reset freeze
  playback. Exact captures lock animation controls and restore viewport time;
  scene clear invalidates pending imports and cancels video capture.
- Duration in seconds survives frame-rate changes. The inspector reads all four
  original PLY binding slots, and legend colors use the GPU's color definition.
- 19 unit tests, typecheck and full lint pass. Ten core browser checks passed,
  including posed queries, 100 rapid seeks across two layers and exact video
  frames. Additional tool/performance tests are being recorded separately.
- Quota checkpoint: 46% remaining; no bottom-line quota reached.

## M10 — refined animation workspace

- User raised the weekly reserve to 80% after upgrading the account. Fresh
  telemetry was 87% remaining, reset 2026-10-09 21:27:42 UTC; a new ledger
  permits 7 points of usage with a 1.75-point handoff reserve. Latest: 86%.
- Replaced the unlabelled control strip with a compact animation header, playing
  state, sample metadata, labelled layer/clip/time/rate fields and clip duration.
  Bind pose and binding colors use native icons and pressed-state feedback.
- Binding details collapse by default; selected Gaussian slots show exact stored
  weights as four readable cards with bars, alongside stable IDs, node legend and
  asset axes. Imported layers use the asset name. Timeline controls have keyboard
  labels, responsive settings and capture-time disabling.
- Updated English/Chinese strings and complete locale fallbacks (410 keys).
  Desktop, 640px and 390px layout checks pass, as do keyboard disclosure, pressed
  states and live Chinese localization with preserved icons.
- Typecheck, full lint, locales, 19 unit tests and release build pass. Full release
  browser coverage and final acceptance records are being completed next.

## Capture keyboard and cancellation checkpoint

- Capture now blocks canvas editing shortcuts while still allowing key release;
  a focused canvas cannot delete bound instances between captured frames.
- Regression covers Delete during capture, scene clear during video export,
  released control locks, late import cancellation and repeated provider disposal.
- Release typecheck/lint/build pass. Vulkan SwiftShader browser suite: 15 passed,
  four explicitly skipped real/performance checks. Weekly remaining: 85%.

## M8/M9 — final regressions and actual-scene acceptance

- Release hardware WebGPU: 20/20 passed (2.1 minutes). Software WebGPU: 15/15
  passed with four explicit skips, plus the subsequently added PNG check.
- Added real edited-subset BGS round trip and full 350,008-instance project
  reload, all compressed snapshot formats including SOG, constructed legacy
  v0/v1 projects, posed selection/volume/depth/brush/measurement/orient tools,
  render overlays, cancellation, repeated imports and keyboard capture protection.
- Unknown double/uchar PLY attributes retain exact types and values after row
  reordering, shear and color edits; 19 unit checks pass. Independent reference
  Python tests 5/5 and JS self-check pass. Input and both actual exported BGS
  bundles pass reference validation with fresh manifest checks.
- Recorded separate real/synthetic 350k 1080p reports: approximately 60 render
  fps and 44.5/47.5 complete pose fps; GPU medians 11.67/11.85ms. Estimated
  renderer GPU working set 97.30MB animated vs 41.22MB static; not whole-device
  measured VRAM. Adapter reports NVIDIA Lovelace, no specific device model.
- Added user/extension guide and acceptance report with original JSON evidence,
  UI screenshots, precision separation, data quality limits and reproducible
  commands. CI adds software WebGPU, typecheck and unit checks; remote run status
  is checked separately after push. M8/M9/M10 local acceptance complete.
- Weekly remaining: 85%; the 80% hard reserve has been maintained.

## Remote software-renderer diagnosis

- First GitHub browser run 37219883465 exceeded its 15-minute limit. Build,
  typecheck, unit tests and lint passed, but WebGPU buffers lost their instance
  reference during canvas initialization; this was not a passed browser run.
- Reproduced the missing SharedImageBackingFactory with a standalone launch.
  A buffer-only device check passed, so added an actual canvas clear/readback
  preflight, explicit SwiftShader adapter/ANGLE/Vulkan paths and raster settings.
  CI now prints test progress, fails after the first failure and includes browser
  stderr diagnostics. Local baseline Vulkan smoke passed before the final fully
  software compositor configuration; verification continues below.
- Final fully software configuration (SwiftShader for both presentation and Dawn):
  device/canvas preflight and shared animated geometry checks passed, including
  2.4229e-8 maximum DQ matrix error. Remote rerun follows this configuration.
