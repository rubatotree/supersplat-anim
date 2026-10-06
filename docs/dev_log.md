# Animation development log

## 2026-10-06 — 外观面板合并

- 颜色、渲染属性和调色控件从场景面板移入右侧“外观”面板，保留折叠分区
  及当前图层的编辑行为；外观面板限制高度并可滚动，窄窗口下保持在画布内。
- 移除底部动画面板的“绑定节点染色”按钮；绑定对象染色使用统一的渲染属性选择。
- 更新属性与动画面板的浏览器回归，检查新入口、绑定对象模式和旧按钮移除。
- 验证：typecheck、lint、24 个单元测试与 release 构建通过；Chrome WebGPU
  属性/动画浏览器回归 13 项通过，真实生产样例测试跳过。原有临时示例截图
  已更新，包含外观面板展开后的属性控件。

## 2026-10-06 — Gaussian 属性着色与伪法线

- 着色面板新增每图层独立的原始颜色、深度、法线、伪法线、绑定对象、
  透明度、自定义标量及 RGB 通道。标量支持 Viridis/Turbo/Inferno/灰度、
  GPU 自动范围及手动上下限；自动识别常见三分量字段，也可自行配通道。
- 法线优先读取 nx/ny/nz，以逆转置转换至世界空间；无效或缺失时使用
  当前协方差的最短主轴。刚体/正交轴提供快速路径，剪切使用 Jacobi 分解。
- 伪法线逐图层合成期望深度（Gaussian footprint、透明度与遮挡均参与），
  再重建视空间位置并微分，转换到世界空间法线颜色。重建颜色回到统一
  排序通道合成，所以多个属性图层仍正确遮挡。诊断颜色跳过 SH、RGB 调色
  和 tone mapping；保留原有透明度、选择覆盖层与独立拾取。
- 属性模式暂停随机透明度/warp，使用排序后的 alpha blending。设置支持
  撤销/重做、图层复制/分离及 ssproj 保存恢复；旧工程默认原始颜色。
  图片和视频捕获等待自定义列上传后再渲染，数据导出保留源属性。
- 属性列按需读取，以重排后的源行和 instanceSource 对齐。过期异步请求
  不覆盖新设置；GPU 辅助数据随模式/资源切换或清空释放，并纳入渲染统计。
- 验证：24 个单元测试；实际 Chrome WebGPU 属性数值、透视/正交伪法线、
  面板操作、撤销/重做、工程恢复、PNG/三帧 WebM 导出与窄面板通过。
  既有动画、旧工程、导出、生命周期和选择工具回归通过；生产样例测试
  未运行（BGS_SKIP_REAL=1）。typecheck、lint、428 个 locale key 检查通过。
- 最终 release 构建成功，发布产物上的属性与选择工具回归 5/5 通过。
- 35 万 Gaussian 合成样例，1280×610：原始颜色/深度/法线平均帧间隔
  约 5.5 ms，伪法线约 8.0 ms；这是本机短时测量，不是通用性能承诺。
  伪法线辅助目标约 18.74 MB，切回原始颜色后恢复至 8-byte 占位纹理。
- 限制：同时可见的伪法线图层最多 63 个；支持 float32-blendable 的
  设备使用 RGBA32F 深度，不支持时使用归一化 RGBA16F，微分精度较低。
  390px 下新增面板无溢出；原有底部工具栏仍宽于窗口，本次未改其布局。
- Windows 浏览器验证使用 BGS_WEBGPU_NATIVE=1 与 --headed，选择安装的
  Chrome 原生 GPU 后端。原有强制 Vulkan 的 Chromium 配置在本机回退到
  WebGL 并报 createBufferImpl 错误；新增开关避免更改其它平台默认配置。

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

## Delivery closure — 2026-10-05

- Final fully software local suite: 17 passed, four intentional skips (4.2m).
  Additional hardware adapter/canvas readback preflight passed, confirming
  NVIDIA Lovelace with fallback=false.
- GitHub rerun 37221389015 on 4adbeae: ALL jobs passed. Software browser
  suite: 17 passed, four intentional skips (4.3m); build, typecheck/19 unit
  tests, lint and locales passed. Machine-readable CI summary is committed.
- Updated fork README, completed HANDOFF, acceptance notes and Chromium primary
  configuration links. Original failed CI remains documented, not counted as
  passed. No pending required engineering or acceptance items for this goal.
- All code/validation commits pushed to origin/main without force; final docs
  commit follows. No production assets or stress binaries committed.
- Latest live quota: 85% remaining, above the user's 80% hard floor.

## UI polish and scene.json import — 2026-10-05

- BGS import now accepts a lone `scene.json` next to its assets (folder picker
  or drag), in addition to zip/directory/multifile/URL. New `src/animation/bgs-import.ts`
  holds the filename/path helpers; unit and browser coverage added.
- Animation panel gained a collapse toggle on the timeline row (persisted in
  localStorage under `supersplat:animationPanelCollapsed`); collapsed state
  hides the whole animation controls block including its header, leaving the
  timeline row and its chevron toggle. Disclosure indicators use the
  existing `arrow.svg` chevron rotated by CSS instead of text glyphs.
- Readability: legend text no longer inherits the black body color; field
  labels raised to 11px; binding slot values white; details area scrolls at
  190px max height. Three `display` overrides were needed because explicit
  flex rules beat PCUI's `.pcui-hidden`.
- Verified in real Chrome (WebGPU) at 1280/640/390px: no horizontal overflow,
  collapsed height 118px, persistence across reload. Playwright headless on
  this Windows box still fails at engine canvas init (`createBufferImpl`)
  with and without these changes — environment, not regression.
- typecheck, lint, locales (412 keys) and 20 unit tests pass.
- Panel now defaults to collapsed (stored value `'0'` means an explicit expand);
  the binding-details sub-panel has no independent disclosure anymore and is
  shown whenever the panel is expanded. `animation.details` locale key removed;
  performance/real-edit specs expand the panel before asserting visibility.
