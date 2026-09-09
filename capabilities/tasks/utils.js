import { execFileSync } from 'node:child_process';
export function sourceRevision(path) {
  try {
    if (execFileSync('git', ['-C', path, 'status', '--porcelain'], {
      encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()) return null;
    return execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], {
      encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { return null; }
}

export function capabilityResult(manifest, hook, {
  status = 'ok', value = null, receipts = [], events = [], artifacts = [],
} = {}) {
  const contract = manifest.hooks.find(item => item.name === hook);
  return {
    schema: 'opsle.capability-result.v1',
    capability: manifest.id,
    hook,
    output_schema: contract.outputSchema,
    status,
    value,
    receipts,
    events,
    artifacts,
  };
}
