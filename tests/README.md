# Test strategy

`reducer.test.js` maps to the named invariants in `SPEC.md`. It covers exact
determinism, large success reduction, single and multiple failures, assertions,
stacks, crashes, timeouts, aggregate correctness, stdout/stderr provenance, ANSI,
Unicode, malformed UTF-8 and text, final-newline boundaries, exact measurements,
payload ceilings, raw escalation, CLI failure behavior, and the complete
synthetic conformance corpus.

These tests establish prototype behavior, not the EXP-001 hypothesis.

`tasks-capability.test.js` is the missing-input blocker regression for task 22.
It runs automatically under `npm test`, packs and installs the external package
offline, checks pinned Tasks fixture hashes, and exercises the unchanged generic
loader in isolated fresh processes without the host checkout. It covers the
operator authority lifecycle and the package's semantic/private evidence
boundaries. Missing or mismatched inputs fail rather than skip. This establishes
reproducible package compatibility, not Tasks bundled-removal or provider delivery.
