# Synthetic conformance corpus

`corpus.js` defines 30 deterministic public-safe fixtures. Large and repetitive
transcripts are generated from fixed recipes so the repository does not contain
unnecessary generated logs. Every fixture has an expected verdict, retained
evidence, escalation state, or ceiling failure.

The corpus covers normal success and skipping; single, mixed, and multiple
failures; assertion and stack details; runner crash, unexplained exit, timeout,
and interruption; stdout/stderr, ANSI, Unicode, long lines, missing newline,
repetition, malformed output, misleading keywords; ceiling tiers; and supplied
or missing provenance.

This is conformance evidence only, not an experimental dataset or benchmark.
