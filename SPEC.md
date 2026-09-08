# Context Firewall test-output reducer specification

Status: experimental prototype contract.

Packet version: `opsle.context-firewall.evidence-packet/v1`.

Model-evidence projection version:
`opsle.context-firewall.model-evidence/v1`.

Reducer policy revision: `test-output-policy/v2`. It recognizes the documented
TAP subset and Node's native spec and dot reporter records.

## Compatibility boundary

The reference primitive accepts generic test-run bytes and emits generic
structured evidence. It must not require a Taslos Tasks database, worker,
scheduler, package, runtime path, private service, model, provider, or network.
Decision Evidence Protocol and Agent Trajectory Profiler compatibility is by
documented fields, not package imports.

## Input contract

An input uses protocol
`opsle.context-firewall.test-run-input/v1` and contains:

- `operation_id`: caller-supplied stable operation identity;
- `source.id` and optional `source.run_id`;
- `source.raw_evidence_ref`: caller-owned address for raw bytes;
- `process.exit_code`: integer 0 through 255;
- optional supplied `process.duration_ms` and `process.interrupted`;
- one or two uniquely named `stdout`/`stderr` streams encoded as UTF-8 or base64.

Invalid envelope shape is rejected. Missing semantic provenance is represented
in a packet and triggers escalation when the envelope can still be parsed.

## Output contract

The canonical JSON packet contains:

- `status`: `passed`, `failed`, or `indeterminate`;
- `disposition`: `SUFFICIENT` or `NEEDS_RAW_EVIDENCE`;
- stable `reason_codes` for every insufficiency;
- process status, aggregate counts, failure regions, fatal/timeout/warning data,
  and unclassified evidence;
- source, reducer, policy, configuration, retained/suppressed, raw-evidence, and
  measurement receipts;
- SHA-256 source-byte, configuration, and semantic-payload identities.

Object keys are serialized in lexical order with one final newline. Arrays retain
source order. No time, latency, random ID, filesystem state, locale, or ambient
environment value enters canonical output.

## Visible Value contract

The packet remains the compatible default model-visible stdout. A caller may derive a
sibling `opsle.value-receipt.v1` with `reduceWithValueReceipt()` or request a
canonical CLI sidecar with `--value-receipt`. The receipt is not embedded in the
packet and does not increase model-visible stdout.

A caller that retains the full packet as audit evidence may request the
supported semantic-only `opsle.context-firewall.model-evidence/v1` projection
with `--model-evidence` or derive it with `modelEvidenceForPacket()`. The
projection contains the packet operation identity and its exact
`decision_evidence`, but excludes the packet `receipt`. It is deterministic and
does not change packet bytes, hashes, classification, retention, or escalation.
Downstream consumers remain responsible for measuring actual submission. The
existing `initial_model_visible_bytes` measurement continues to describe the
canonical packet stdout for compatibility; it does not claim that a downstream
consumer submitted either representation.

The mechanism identity is `opsle.context-firewall`, the operation is
`test-output-reduction`, and the receipt contains `raw_bytes`,
`initial_model_visible_bytes`, `bytes_initially_avoided`,
`initial_reduction_ratio`, `original_evidence_events`,
`retained_evidence_events`, `suppressed_evidence_events`,
`ambiguous_evidence_events`, `payload_ceiling_bytes`, `escalation_required`, and
`raw_locator_available`.

Byte and event measurements are `EXACT`; escalation and raw-locator state are
`OBSERVED`. The avoided-byte delta is raw minus visible bytes and may be negative
for packet expansion. The ratio is an exact signed numerator/denominator string
and is not directly summable. A raw locator is caller supplied and is not proof
that the external artifact exists or was verified. Byte evidence supports no
token, cost, latency, correctness, or causal claim.

An exact mechanism revision may be caller supplied. It affects only the sibling
receipt and defaults to `null`; ambient repository state is never inspected.
Successful CLI reductions write only the canonical packet to stdout and one
named `[Context Firewall]` indicator to stderr. Invocation failures retain their
machine-readable stderr behavior and emit no success indicator.

## Evidence taxonomy

Source lines have exactly one class:

- `successful_test`, `skipped_test`;
- `failed_test`, `failure_message`, `assertion`, `stack_trace`,
  `failure_detail`;
- `fatal_error`, `timeout`, `abnormal_warning`;
- `aggregate_source`, `duration_source`, `structure`, `informational`, `blank`;
- `unclassified` or `unclassified_binary`.

Derived evidence adds run verdict, process status, aggregate counts, stream
provenance, and reason codes. Matching is structural and strict; keywords inside
otherwise valid test names or explicit notes have no special meaning.

## Invariants

1. Fixed source bytes, invocation semantics, reducer version, policy revision,
   and options produce byte-identical output.
2. Every recognized failed-test region is retained in full in a sufficient
   packet.
3. Each source event is counted as retained or suppressed, never neither or
   both.
4. Suppression from model context is distinct from raw-evidence destruction.
   This reducer destroys nothing.
5. Unclassified, malformed, contradictory, truncated, or under-provenanced
   evidence cannot yield a `SUFFICIENT` disposition.
6. A payload ceiling never silently turns omitted critical evidence into a
   sufficient packet.
7. `measurements.reduced_bytes` equals the canonical serialized packet length.
8. The input hash binds stream names, lengths, order, and exact bytes.
9. Value-receipt visible bytes equal the final serialized packet length; deriving
   or writing the receipt never changes packet bytes.
10. Operator telemetry is derived from the completed sibling receipt and remains
    outside canonical stdout.
11. Model-evidence projection preserves packet `operation_id` and
    `decision_evidence` exactly while excluding the packet `receipt`.

## Payload policy

The deterministic priority order is verdict/process, fatal/timeout, failed test
identity and complete region, aggregates, abnormal warnings, unclassified data,
then repetitive success/structure.

The default packet suppresses repetitive success and structural lines. If the
packet exceeds `maxOutputBytes`:

1. warning and unclassified text becomes hash/location references and the packet
   requires raw evidence;
2. if complete critical regions still cannot fit, a compact escalation packet
   retains failed identities but declares critical evidence omitted;
3. if the compact packet cannot fit, no valid stdout packet is emitted and a
   typed `PAYLOAD_CEILING_TOO_SMALL` control error is returned.

## Raw-evidence escalation

`NEEDS_RAW_EVIDENCE` applies for unclassified/malformed evidence, contradictions,
interruption, missing process or source identity, missing raw reference,
unexplained nonzero exit, or payload-driven omission. The receipt records whether
a caller reference was supplied. It does not claim that the external artifact
exists, is immutable, or was verified.

## Idempotency and crash consistency

The reducer is pure apart from reading CLI input and writing one result. It has no
store and makes no ambient mutation. Repeating an invocation is the idempotency
mechanism. The caller owns durable raw evidence and atomic publication if those
properties are required.

## Conformance requirements

An implementation conforms only when automated tests cover deterministic replay,
large success reduction, complete single/multi-failure retention, aggregate
correctness, stdout/stderr provenance, exact measurements, ambiguous/malformed
input, payload boundaries, typed escalation, and absence of generated semantic
time/randomness.

## Versioning

Breaking input, output, classification, priority, hash-framing, or escalation
semantics require a new protocol or policy version. Optional fields require
evidence of decision value before admission.
