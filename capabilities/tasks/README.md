# Context Firewall capability for Opsle Tasks

`@opsle/context-firewall-tasks-capability` 0.1.0 is independently versioned
from the standalone Context Firewall CLI (compatible baseline: 0.5.0,
revision `6dd6e5fdf21f28dc5ebfa07954aaa9bed2dbcc32`). It owns its adapter
and helpers; it invokes the configured CLI through its public JSON interface.
It has no npm dependencies or Tasks-internal imports.

Compatibility is pinned to the generic manifest/result contract in Opsle Tasks
`50f2666b2ddf3b95fc77c7e7bd8d64b6807e91f8`. Other Tasks releases require
compatibility verification before use. The required `command.evidence` hook is
a deterministic authority, never a model-backed hook.

## Trusted installation

An operator can build an archive with `npm pack --ignore-scripts` in this
directory, then install that archive with
`npm install --ignore-scripts --prefix /trusted/capability-install /path/to/archive.tgz`.
Install the standalone Context Firewall repository separately. Set
`OPSLE_CONTEXT_FIREWALL_REPO` to its absolute path and optionally set
`OPSLE_CONTEXT_FIREWALL_MAX_BYTES` (default 12000). The repository path has no
default and cannot be supplied through project-controlled selection.

Include the installed directory
`/trusted/capability-install/node_modules/@opsle/context-firewall-tasks-capability`
in the operator-owned `OPSLE_CAPABILITY_PATH` discovery roots (preserving other
required roots). Scope discovery so it contains exactly one installation of
`opsle.context-firewall`.

The manifest uses `default_enabled: false`. The operator must add
`opsle.context-firewall` to the project's `opsle.capability-grants.v1` `allow`
array. That grant activates the authority directly. Repository selection must
neither enable nor disable this authority. Keep grant changes outside active
executions, as required by Tasks policy. No live configuration is changed by
this package or its tests.

Revoke the operator grant to disable the authority; a subsequent required
invocation fails without an authority. Remove the installed package after
revocation. Reinstallation requires the same trusted discovery/configuration
and grant. For a compatible upgrade, replace the installed package and restart
Tasks so its ESM module cache is refreshed.

**Tasks-owned prerequisite:** the pinned Tasks release still bundles this same
capability identity. Removing that bundled package and any identity-specific
Tasks integration is a separate project-20 task. This repair does not perform
that removal or claim the original cross-repository feature is shipped.

## Evidence boundary and verification

Only `value.decisionEvidence` supplies the semantic model projection, with
exactly `protocol_version`, `operation_id`, and `decision_evidence`. The full
canonical packet remains in `auditEvidence`, and Visible Value measurements
travel in the separate private `receipts` channel. The complete result envelope
and raw `run` are not initial model context. Raw-evidence requests remain
explicit; an impossible ceiling remains a required failure. Delivery is marked
as constructed/stored, never as verified provider submission.

The repository's `npm test` runs `tests/tasks-capability.test.js`: it hashes
vendored pinned inputs, packs/installs offline in a temporary root, and invokes
the unmodified generic loader in fresh Node processes. It tests grant ownership,
private receipts, exact model projection, native Node reporter classification,
raw escalation, ceilings, removal/reinstall and a synthetic compatible patch
upgrade. The standalone CLI is copied into the isolated root. The test neither
uses the host Tasks checkout nor edits Tasks. It also checks all packaged JS
imports and verifies that loader/reference bytes remain unchanged.

The test-only harness denies unused host execution/model/provider imports;
it does not establish end-to-end provider delivery. Run the normal catalog
`npm test`, `npm run check`, and `npm run conformance` before release.
