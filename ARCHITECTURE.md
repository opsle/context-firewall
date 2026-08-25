# Architecture

```text
caller-owned raw stdout/stderr
              |
              v
 strict TAP-subset parser
              |
              v
 evidence classes + verdict
              |
              v
 deterministic ceiling policy
        |             |
        v             v
 sufficient       NEEDS_RAW_EVIDENCE
 packet           packet/control error
```

## Modules

- `src/reducer.js`: validation, byte framing, parsing, classification, policy,
  hashing, measurement, and canonical serialization.
- `bin/context-firewall.js`: stdin/file CLI and deterministic conformance entry.
- `fixtures/corpus.js`: synthetic public-safe fixture definitions and expected
  decisions.
- `tests/reducer.test.js`: success, failure, provenance, ambiguity, determinism,
  measurement, and ceiling gates.

The core has no host adapter or external package dependency. Supporting Opsle
protocols can consume the JSON fields without importing this package.

## Evidence ownership

The caller owns storage and addressability of raw bytes. The reducer binds those
bytes to a digest and records the caller's reference. It neither stores nor
destroys the source. A later decision record can bind the reduced semantic hash,
input hash, configuration identity, and raw reference to state exactly what the
agent saw.

## Deterministic boundary

Caller-supplied duration is semantic input. Reducer execution latency is an
external measurement and must not enter the hashed packet. There is no clock,
randomness, network, locale sorting, or ambient host inspection in the core.
