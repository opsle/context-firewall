// Test-only process boundary: the pinned generic loader runs unchanged.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const request = JSON.parse(readFileSync(0, 'utf8'));
try {
  const { createCapabilityRuntime, discoverCapabilities } = await import(pathToFileURL(request.loader));
  const events = [];
  const runtime = await createCapabilityRuntime({
    config: request.config,
    task: { id: 22, capability_grants: { schema: 'opsle.capability-grants.v1', allow: request.grants } },
    selection: { schema: 'opsle.capability-selection.v1', enable: [], disable: [], configuration: {}, ...request.selection },
    attemptId: 1, executionId: 'isolated-compatibility',
    emitEvent: (kind, message) => events.push({ kind, message }),
  });
  const results = request.discoverOnly ? null
    : await runtime.authority('command.evidence', request.payload);
  process.stdout.write(JSON.stringify({
    discovered: discoverCapabilities(request.config).map(({ id, version }) => ({ id, version })),
    active: runtime.manifests.map(({ id }) => id), results, events,
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error.message, code: error.code, owner: error.owner }));
}
