# Test strategy

`reducer.test.js` maps to the named invariants in `SPEC.md`. It covers exact
determinism, large success reduction, single and multiple failures, assertions,
stacks, crashes, timeouts, aggregate correctness, stdout/stderr provenance, ANSI,
Unicode, malformed UTF-8 and text, final-newline boundaries, exact measurements,
payload ceilings, raw escalation, CLI failure behavior, and the complete
synthetic conformance corpus.

These tests establish prototype behavior, not the EXP-001 hypothesis.
