# Theory

## Observation

Tools often send models large volumes of successful-test noise, shell chatter, and repeated state that does not affect the next decision.

## Hypothesis

Policy-driven reduction can remove substantial operational payload without lowering correctness when escalation and provenance remain available.

## Proposed mechanism

Apply allow rules, suppression, aggregation, escalation, deterministic reducers, and payload ceilings between raw tool output and the model; retain links to auditable raw artifacts.

## Falsifiable requirements

1. Information required for safe or correct reasoning is never intentionally suppressed.
2. Every reduction is deterministic for a fixed input and policy revision.
3. Provenance and raw-output escalation remain available.
4. Payload ceilings fail according to an explicit policy.

## Disconfirming results

The hypothesis should be weakened or rejected if a comparable baseline passes the same correctness gate and this mechanism provides no repeatable benefit, or if the mechanism introduces safety/correctness failures that bounded revisions do not resolve. Negative results remain in `experiments/`.

## Uncertainty

Task-stratified correctness curves, reducer conformance suites, escalation policy, and adversarial omission testing.
