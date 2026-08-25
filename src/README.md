# Reference surface

`reducer.js` exports the dependency-free core:

- `normalizeInvocation(value)` validates and decodes the public input envelope;
- `reduceTestRun(value, options)` returns a deterministic evidence packet;
- `serializePacket(packet)` returns canonical UTF-8 JSON with a final newline;
- `PayloadCeilingError` represents a ceiling too small for any safe packet.

The core performs no I/O, model calls, network calls, persistence, or host
integration.
