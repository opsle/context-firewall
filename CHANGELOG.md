# Changelog

## 0.3.0 - 2026-08-25

- Added a dependency-free sibling `opsle.value-receipt.v1` for reductions with
  exact byte/event measurements and observed escalation/raw-locator state.
- Added `reduceWithValueReceipt()` and an optional deterministic
  `--value-receipt` sidecar without increasing model-visible packet stdout.
- Added caller-supplied `--mechanism-revision` provenance that affects only the
  receipt and never inspects ambient Git state.
- Added one named `[Context Firewall]` completion indicator on stderr plus
  receipt, expansion, aggregation, trust, zero-baseline, channel-separation,
  conformance, and static-check gates.
- This remains prototype evidence, not EXP-001 or a correctness, cost, latency,
  token, or causal claim.

## 0.2.0 - 2026-08-25

- Added a dependency-free deterministic TAP-subset reducer and CLI.
- Added canonical evidence/provenance receipts, exact payload measurements,
  source/configuration hashes, and explicit raw-evidence escalation.
- Added deterministic payload ceilings that fail closed when critical evidence
  cannot fit.
- Added 30 synthetic conformance fixtures and 33 automated boundary tests.
- Promoted implementation maturity only to PROTOTYPED; EXP-001 remains PLANNED.

## 0.1.0 - 2026-08-25

- Published initial theory, falsifiable specification, benchmark plan, architecture, and provenance.
- Marked maturity THEORY.
- Added no benchmark claims.
