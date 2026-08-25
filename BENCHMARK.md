# Benchmark plan

## Rule zero: correctness gate

Efficiency results are comparable only when every candidate passes the same deterministic correctness and safety gates. Incorrect, indeterminate, and policy-violating runs remain visible but are excluded from superiority claims.

## Baselines

1. Current conventional mechanism without this project.
2. The narrowest deterministic alternative.
3. This project at an exact revision and configuration.

## Measurements

- correctness
- input bytes/tokens
- suppression ratio
- escalation rate
- missing-evidence defects
- reducer latency

## Repetition and reporting

Record model, provider, model version, reasoning effort, tool versions, fixture, prompt, environment/hardware, repetition count, observable tool activity, final result, correctness, cost/tokens when available, and known confounders. Report distributions and raw observations; never invent missing values.

## Adversarial cases

- Attempt to violate: Information required for safe or correct reasoning is never intentionally suppressed.
- Attempt to violate: Every reduction is deterministic for a fixed input and policy revision.
- Attempt to violate: Provenance and raw-output escalation remain available.
- Attempt to violate: Payload ceilings fail according to an explicit policy.

## Result policy

Retain positive, negative, null, and failed experiments. Update maturity only when the actual stated hypothesis has reproducible evidence.

## Prototype conformance is not EXP-001

`npm run conformance` executes synthetic parser/reducer boundary fixtures. Its
byte measurements demonstrate implementation behavior only. They are not model
correctness, a baseline/arm comparison, a frozen experimental dataset, or a
provider run, and must not be registered as EXP-001 results.

Before EXP-001 can run, publish immutable task fixtures and hashes, a correctness
oracle, a harness with raw/reduced arms, exact model/provider configuration, and
randomized or blinded task allocation. Correctness must gate every efficiency
comparison.
