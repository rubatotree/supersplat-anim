# 4DGS animation roadmap

## Architecture

Keep immutable Gaussian resources and instance editing separate. An animation
provider evaluates fixed-topology assets at a time in seconds. BGS 0.1 is the
first provider; the contract must also admit asynchronous neural deformation.
All rendering, selection, bounds and export consumers must use the same posed
geometry access path. Camera keyframes and PLY sequences remain supported.

BGS retains its metre, right-handed Z-up asset coordinates. A single display
transform maps the asset to editor Y-up coordinates. Scene-frame SH does not
rotate with the animated nodes. BGS geometry edits are canonical: the current
pose edit is conjugated through each Gaussian's rigid deformation.

## Milestones

- [x] M1: typed provider contract, seconds clock, loop/endpoints and tests.
- [ ] M2: validated BGS directory/ZIP/URL loading and CPU reference evaluation.
- [ ] M3: GPU deformation shared by render, sorting, picks, selection and bounds.
- [ ] M4: native PCUI animation controls, bind pose, binding colours/inspection.
- [ ] M5: canonical affine edits, undo/redo, deletion and shared-layer operations.
- [ ] M6: animation resources and edit state in backwards-compatible ssproj.
- [ ] M7: static posed snapshots, video synchronisation and BGS round trips.
- [ ] M8: WebGPU integration/regression tests and 350k synthetic performance report.
- [ ] M9: real pick-the-block scene acceptance when its complete BGS package arrives.

## Engineering risks and acceptance

- Preserve source IDs, all four weight slots and unknown PLY properties through
  resource reordering and serialization.
- CPU interpolation, hierarchy and dual-quaternion evaluation must agree with
  the supplied five mathematical fixtures. GPU packing error is measured separately.
- Avoid using the existing 16-bit transform palette for per-Gaussian inverse edits.
- Render/selection/bounds must commit matching pose versions; stale asynchronous
  loads and readbacks must not overwrite newer requests or destroyed scenes.
- Full affine covariance transforms must survive editing and snapshot export.
- Standard BGS cannot encode every layer-space edit. Reject unsupported export
  requests explicitly; ssproj remains the complete editor document.
- Validate static and animated views, editing, save/reload, snapshots and BGS
  reload. Record actual evidence, failures and unverified items.

## Delivery and budget

Use atomic Conventional Commits, verify each logical milestone, then push to
origin/main without force. Update docs/dev_log.md at each checkpoint.
No large production assets or ntfy notifications are included.

Weekly quota baseline: 48% used / 52% remaining. Hard ceiling: 68% used.
Start handoff at 63% used, retain 5 percentage points for verification and
handoff. Refresh the seven-day meter before/after material units; stop if the
meter becomes unavailable or the ceiling is reached. On early stop write
docs/HANDOFF.md with commits, changes, tests, reproduction and remaining work.

The local BGS production sample is explicitly incomplete: only the synthetic
five-Gaussian conformance package is currently loadable. M9 cannot be marked
complete until the real assets exist and their own checks pass.
