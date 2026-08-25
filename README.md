# Context Firewall

> Experimental Opsle research. Claims are hypotheses until evidence supports them.

## Problem

Tools often send models large volumes of successful-test noise, shell chatter, and repeated state that does not affect the next decision.

## Hypothesis

Policy-driven reduction can remove substantial operational payload without lowering correctness when escalation and provenance remain available.

## Mechanism

Apply allow rules, suppression, aggregation, escalation, deterministic reducers, and payload ceilings between raw tool output and the model; retain links to auditable raw artifacts.

## Why it matters

The Opsle thesis asks: **What if we stopped using intelligence for work that doesn’t require intelligence?** This project isolates one candidate boundary so it can be falsified and measured independently.

## Non-goals

Hiding failures, lossy summarization without provenance, or assuming every tool can use the same fail-open/fail-closed policy.

## Current maturity

**THEORY** under the [Opsle maturity model](https://github.com/opsle/research/blob/main/MATURITY.md).

## Existing evidence

Bounded context construction and redaction patterns demonstrate feasibility. The safe reduction frontier is not established.

## Evidence still missing

Task-stratified correctness curves, reducer conformance suites, escalation policy, and adversarial omission testing.

## Benchmark strategy

Correctness gates every comparison. Planned measures:

- correctness
- input bytes/tokens
- suppression ratio
- escalation rate
- missing-evidence defects
- reducer latency

See [BENCHMARK.md](BENCHMARK.md) for experiment rules. No benchmark numbers are claimed.

## Relationship to other Opsle research

This project is part of [Opsle Research](https://github.com/opsle/research). Opsle Tasks is the future public name of the integrated reference system from which several ideas emerged. Its active development migration to the Opsle organization is intentionally deferred.

## Relationship to future Opsle Tasks

Future Opsle Tasks may consume this project through an adapter only after evidence supports integration. The active predecessor, Taslos Tasks, remains unchanged and has no dependency on this repository.

## Installation status

No installable production package is justified yet. The repository is theory/specification-first.

## Known limitations

Task-stratified correctness curves, reducer conformance suites, escalation policy, and adversarial omission testing.

## License

Apache-2.0. See [LICENSE](LICENSE).
