# Context Firewall test-output reducer specification

Status: experimental prototype contract.

Version: `opsle.context-firewall.evidence-packet/v1`.

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
