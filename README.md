# Context Firewall

> Experimental Opsle research. Claims are hypotheses until evidence supports them.

## Thesis

Operational output should not become model-visible merely because a tool emitted
it. Deterministic software can suppress repetitive success output while retaining
decision evidence, provenance, measurements, and a safe path back to raw bytes.

The broader research question is: **How much context can an AI coding agent
safely not see?** This repository does not yet answer it.

## Prototype scope

Version 0.4.0 is a dependency-free Node.js reference reducer for a documented
flat TAP-compatible test-output subset. It:

- reads caller-supplied stdout and stderr bytes plus process metadata;
- derives test verdict and pass, fail, and skip counts;
- retains every recognized failure header and failure-region line;
- retains strict fatal, timeout, and abnormal-warning markers;
- summarizes successful tests, structure, duration source lines, and explicit
  informational notes;
- retains ambiguous or malformed evidence and requires raw-evidence escalation;
- emits canonical JSON with source/configuration hashes and payload measurements;
- derives a sibling `opsle.value-receipt.v1` without adding it to model-visible
  stdout;
- emits one named operator completion indicator on stderr;
- applies deterministic payload ceilings without silently truncating critical
  evidence.

It does not parse arbitrary logs, Git output, compiler output, database output,
HTTP traces, or every test runner. It has no model, provider, network, database,
daemon, worker, UI, or product integration. It is not a production security
boundary.

## Requirements

- Node.js 20 or newer
- no package installation or network access

## Input

The CLI accepts one JSON object from stdin or `--input`. The input protocol is
`opsle.context-firewall.test-run-input/v1`.

```json
{
  "protocol_version": "opsle.context-firewall.test-run-input/v1",
  "operation_id": "op-public-example",
  "source": {
    "id": "synthetic-suite",
    "run_id": "run-public-example",
    "raw_evidence_ref": "artifact://public/run.tap"
  },
  "process": {
    "exit_code": 1,
    "duration_ms": 12.5,
    "interrupted": false
  },
  "streams": [
    {
      "name": "stdout",
      "encoding": "utf8",
      "data": "TAP version 13\nnot ok 1 - adds\n  message: expected 2\n1..1\n# tests 1\n# pass 0\n# fail 1\n# skipped 0\n"
    }
  ]
}
```

Each stream is `stdout` or `stderr`; each may appear at most once. `encoding` is
`utf8` or `base64`. Base64 permits exact non-UTF-8 source bytes to be hashed and
reported without pretending they were classifiable text.

Run the example:

```bash
node ./bin/context-firewall.js reduce \
  --input examples/test-run-input.json
```

Read from stdin with a 4,096-byte ceiling:

```bash
node ./bin/context-firewall.js reduce \
  --max-bytes 4096
```

## Output packet

The output protocol is
`opsle.context-firewall.evidence-packet/v1`. Canonical JSON contains:

- `decision_evidence`: `passed`, `failed`, or `indeterminate` status; a
  `SUFFICIENT` or `NEEDS_RAW_EVIDENCE` disposition; reason codes; process state;
  aggregates; failures; fatal errors; timeouts; warnings; and unclassified data;
- `receipt.source`: caller-supplied source/run identity and per-stream byte
  counts;
- `receipt.reducer` and `receipt.configuration`: exact reducer, policy, ceiling,
  and configuration hash;
- `receipt.input_hash`: SHA-256 over framed stdout/stderr bytes;
- `receipt.semantic_payload_hash`: SHA-256 over canonical decision evidence;
- `receipt.measurements`: exact raw/reduced bytes and original, retained, and
  suppressed event counts;
- `receipt.retained` and `receipt.suppressed`: explicit evidence taxonomy and
  counts;
- `receipt.raw_evidence`: caller reference, escalation state, and the distinction
  between context suppression and destruction/unavailability.

The reducer never deletes raw evidence. A supplied raw reference is recorded as
`CALLER_REFERENCE_SUPPLIED`; the reducer does not claim it verified the external
artifact. Without a reference, preservation is `PRESERVATION_UNCONFIRMED` and
the packet requires escalation.

`reduced_bytes` is the exact byte length of canonical stdout, including its final
newline. Raw and reduced bytes are sufficient for a trajectory consumer to
calculate visible fraction and reduction ratio without parsing human logs.
Runtime latency is intentionally absent from the hashed packet because it is
nondeterministic; callers may measure it outside the packet.

## Visible Value receipt and operator channel

`reduceWithValueReceipt(input, options)` returns `{ packet, valueReceipt }` while
`reduceTestRun(input, options)` remains packet-only. The value receipt uses
`opsle.value-receipt.v1` and exposes raw/model-visible bytes, signed initially
avoided bytes, an exact rational reduction ratio, original/retained/suppressed/
ambiguous event counts, payload ceiling, escalation, and raw-locator state.
Byte evidence makes no token, cost, latency, correctness, or causal claim.

The CLI always writes only the compact canonical evidence packet to stdout and
one named completion indicator to stderr:

```text
[Context Firewall] 28,981 B -> 1,846 B | 27,135 B initially avoided (93.63%) | escalation: no
```

To persist the deterministic receipt separately, the caller may request a
sidecar:

```bash
node ./bin/context-firewall.js reduce \
  --mechanism-revision REVISION \
  --value-receipt value-receipt.json
```

The caller must keep stderr and the optional receipt sidecar outside initial
decision-relevant model context. Invocation failures retain machine-readable
stderr and emit no success indicator. A negative avoided-byte delta is reported
as packet expansion rather than fabricated savings; ratios are not directly
summable.

## Semantic-only model evidence

The canonical packet remains the compatible default stdout representation. A
caller that retains the packet as audit evidence can request an explicit
semantic-only sidecar with `--model-evidence PATH`. Its protocol is
`opsle.context-firewall.model-evidence/v1` and it contains only
`protocol_version`, `operation_id`, and the packet's byte-identical
`decision_evidence` value. It deliberately excludes the packet `receipt`.

```bash
node ./bin/context-firewall.js reduce \
  --model-evidence model-evidence.json
```

`modelEvidenceForPacket()` and `serializeModelEvidence()` expose the same
deterministic projection to library callers. The sidecar is a supported
model-facing representation, not a second reduction: the full packet remains
the audit authority and the projection changes no classification, retention,
hash, receipt, or canonical stdout behavior. Callers must measure and record
what they actually submit; the producer's legacy `initial_model_visible_bytes`
measurement continues to describe canonical packet stdout, not downstream
delivery of this optional projection.

`--mechanism-revision` is caller supplied, affects only the sidecar, and defaults
to `null`; the deterministic reducer never inspects ambient Git state.

## Deterministic retention policy

Classification is strict and case-sensitive after ANSI is removed for parsing.
Original retained text still includes ANSI bytes.

Priority is:

1. verdict and process exit/interruption state;
2. fatal process/runner and timeout evidence;
3. every failed test identity, header, and failure-region line;
4. aggregate counts and supplied duration;
5. strict `WARNING:` or `WARN:` markers;
6. unclassified evidence;
7. structure, explicit `# note:` lines, and repetitive successful tests.

Recognized failure regions are never partially truncated into a supposedly
sufficient packet. Under a ceiling, the reducer first replaces lower-priority
warning or unclassified text with hashes/locations and requires raw evidence. If
critical evidence still cannot fit, it emits a compact
`NEEDS_RAW_EVIDENCE` packet with failure identities and omits details only while
explicitly declaring the packet insufficient. If even that safe packet cannot
fit, stdout remains empty and the CLI emits a machine-readable
`PAYLOAD_CEILING_TOO_SMALL` error on stderr with exit code 2.

The ceiling applies to model-visible stdout. Error-channel bytes are operational
control output and are not presented as a valid reduced packet.

## Strict TAP subset and limits

The parser recognizes:

- `ok` and `not ok` records, optional numeric indexes, and `# SKIP`;
- indented or adjacent lines following `not ok` until the next test, plan, or
  aggregate as one failure region;
- `# tests`, `# pass`, `# fail`, and `# skipped` aggregates;
- `TAP version`, plans, subtest headers, YAML delimiters, `# duration_ms`, and
  `# note:` as structural/informational lines;
- strict `FATAL:`, `RUNNER CRASH:`, `UNCAUGHT:`, `TIMEOUT:`, `WARNING:`, and
  `WARN:` markers outside failure regions.

Unknown lines, TODO semantics, malformed UTF-8, contradictory aggregates,
interruption, missing exit state, missing source/operation identity, and
unexplained nonzero exits remain explicit and require raw evidence. Words such as
PASS, FAIL, error, and warning are not classified by substring.

This flat subset does not establish full TAP conformance or support arbitrary
nested runner dialects. Small inputs commonly expand because the receipt has
fixed provenance cost; reduction is expected only for sufficiently repetitive
source payloads.

## Verification

Run all tests:

```bash
npm test
```

Run the deterministic synthetic corpus:

```bash
npm run conformance
```

The conformance result is canonical JSON over 30 public-safe fixtures spanning
normal success, normal failure, multi-failure retention, process problems, byte
and text edge cases, payload boundaries, and provenance gaps. It reports raw and
reduced sizes, verdict preservation, escalation, and PASS/FAIL.

These are implementation fixtures, not model experiments or benchmark results.
They do not show that reduced context preserves agent correctness.

## EXP-001

This prototype resolves one prerequisite for planned EXP-001: an executable,
deterministic reducer with synthetic conformance evidence. EXP-001 remains
PLANNED. Frozen experimental task fixtures, a correctness oracle, an experiment
harness, exact model/provider configurations, and randomized/blinded allocation
remain separate work.

## Maturity and limitations

**PROTOTYPED** under the canonical Opsle lifecycle. The implementation and its
boundary tests establish a runnable mechanism, not comparative correctness,
safe-frontier evidence, benchmark readiness, provider evidence, or replication.

See [THEORY.md](THEORY.md), [SPEC.md](SPEC.md), and
[BENCHMARK.md](BENCHMARK.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
