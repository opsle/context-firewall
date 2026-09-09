import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixtures = resolve(root, 'fixtures/tasks-capability');
const packageSource = resolve(root, 'capabilities/tasks');
const id = 'opsle.context-firewall';
const packageName = '@opsle/context-firewall-tasks-capability';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFileSync(path, 'utf8');
const json = path => JSON.parse(read(path));
function files(directory) {
  return readdirSync(directory).sort().flatMap(name => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

// This is the blocker regression: no host Tasks checkout, network, grants, or providers.
test('external Tasks capability consumes the pinned generic contract in an isolated install', t => {
  const provenance = json(resolve(fixtures, 'provenance.json'));
  assert.equal(provenance.revision, '50f2666b2ddf3b95fc77c7e7bd8d64b6807e91f8');
  assert.equal(provenance.contextFirewallRevision, '6dd6e5fdf21f28dc5ebfa07954aaa9bed2dbcc32');
  const expectedInputs = ['docs/CAPABILITIES.md', 'src/capabilities.js', 'src/capability-utils.js',
    'capabilities/context-firewall/adapter.js', 'capabilities/context-firewall/opsle-capability.json',
    'src/adapters/context-firewall.js', 'test/capabilities.test.js', 'test/adapters.test.js',
    'test/context-firewall-boundaries.test.js', 'test/context-firewall-repair.test.js',
    'test/visible-value.test.js', 'LICENSE'];
  assert.deepEqual(Object.keys(provenance.sha256).sort(), expectedInputs.sort());
  for (const [path, hash] of Object.entries(provenance.sha256)) {
    assert.equal(sha256(readFileSync(resolve(fixtures, 'upstream', `${path}.txt`))), hash, path);
  }
  const upstream = path => read(resolve(fixtures, 'upstream', `${path}.txt`));
  assert.equal(read(resolve(packageSource, 'adapter.js')), upstream('capabilities/context-firewall/adapter.js')
    .replace('../../src/adapters/context-firewall.js', './reduce.js')
    .replace('../../src/capability-utils.js', './utils.js'));
  assert.equal(read(resolve(packageSource, 'reduce.js')), upstream('src/adapters/context-firewall.js')
    .replace('../capability-utils.js', './utils.js'));
  const utils = upstream('src/capability-utils.js');
  assert.equal(read(resolve(packageSource, 'utils.js')),
    utils.slice(0, utils.indexOf('import { createHash }')) + utils.slice(utils.indexOf('export function sourceRevision')));

  const temporary = mkdtempSync(resolve(tmpdir(), 'context-firewall-capability-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const npmEnv = { ...process.env, npm_config_cache: resolve(temporary, 'npm-cache'),
    npm_config_userconfig: resolve(temporary, 'empty-npmrc'), npm_config_offline: 'true' };
  writeFileSync(npmEnv.npm_config_userconfig, '');
  const npm = (args, cwd) => execFileSync('npm', args, { cwd, env: npmEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const installRoot = resolve(temporary, 'install');
  mkdirSync(installRoot);
  writeFileSync(resolve(installRoot, 'package.json'), '{"private":true}');
  function pack(source) {
    const result = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], source));
    return resolve(temporary, result[0].filename);
  }
  const archive = pack(packageSource);
  const install = archivePath => npm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', archivePath], installRoot);
  install(archive);
  const installed = resolve(installRoot, 'node_modules', packageName);
  const manifest = json(resolve(installed, 'opsle-capability.json'));
  assert.equal(manifest.default_enabled, false);
  assert.equal(manifest.configuration.repository.default, undefined);
  assert.equal(manifest.version, json(resolve(installed, 'package.json')).version);
  assert.deepEqual(manifest.hooks, JSON.parse(upstream('capabilities/context-firewall/opsle-capability.json')).hooks);
  assert.equal(json(resolve(installed, 'package.json')).dependencies, undefined);
  // Every shipped JS module is a reviewed source file and all imports stay owned.
  assert.deepEqual(files(installed).filter(path => path.endsWith('.js')).map(path => path.slice(installed.length + 1)).sort(),
    ['adapter.js', 'reduce.js', 'utils.js']);
  for (const path of files(installed).filter(path => path.endsWith('.js'))) {
    assert.equal(read(path), read(resolve(packageSource, path.slice(installed.length + 1))));
    assert.doesNotMatch(read(path), /\bimport\s*\(|\brequire\s*\(/);
    for (const match of read(path).matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (specifier.startsWith('node:')) continue;
      assert.ok(specifier.startsWith('./'));
      const dependency = resolve(dirname(path), specifier);
      assert.ok(dependency.startsWith(`${installed}${sep}`));
      assert.ok(existsSync(dependency));
    }
  }

  const loaderRoot = resolve(temporary, 'generic-runtime');
  mkdirSync(loaderRoot);
  writeFileSync(resolve(loaderRoot, 'package.json'), '{"type":"module"}');
  const loader = resolve(loaderRoot, 'capabilities.js');
  writeFileSync(loader, upstream('src/capabilities.js'));
  // Unused host integration imports deliberately fail if reached. No loader code is replaced.
  for (const [file, exports] of Object.entries({ 'execution.js': ['executionTarget', 'projectGit'],
    'model-gateway.js': ['validateModelRequest'], 'provider-metadata.js': ['providerMetadata'] })) {
    writeFileSync(resolve(loaderRoot, file), exports.map(name =>
      `export function ${name}() { throw new Error('Unexpected host integration: ${name}'); }`).join('\n'));
  }
  const loaderBytes = new Map(files(loaderRoot).map(path => [path, sha256(readFileSync(path))]));
  const cliRoot = resolve(temporary, 'standalone-firewall');
  mkdirSync(cliRoot);
  for (const path of ['bin', 'src', 'fixtures/corpus.js', 'package.json']) {
    mkdirSync(dirname(resolve(cliRoot, path)), { recursive: true });
    cpSync(resolve(root, path), resolve(cliRoot, path), { recursive: true });
  }
  // A generic private receipt observer, with no model/provider delivery implementation.
  const observer = resolve(temporary, 'receipt-observer');
  mkdirSync(observer);
  writeFileSync(resolve(observer, 'package.json'), '{"type":"module"}');
  writeFileSync(resolve(observer, 'opsle-capability.json'), JSON.stringify({
    schema: 'opsle.capability-manifest.v1', id: 'fixture.receipts', name: 'Private receipt fixture',
    version: '1.0.0', adapter: 'adapter.js', default_enabled: false,
    hooks: [{ name: 'evidence.receipt', input_schema: 'opsle.execution.receipt-notification.v1',
      output_schema: 'opsle.capability.ack.v1', role: 'observer', execution: 'deterministic', failure: 'required' }],
  }));
  writeFileSync(resolve(observer, 'adapter.js'), `import {writeFileSync} from 'node:fs';
export function createCapability({manifest,services}) { return {invoke(hook,payload) {
writeFileSync(services.logsDir+'/private-receipt.json', JSON.stringify(payload.receipt), {mode:0o600});
return {schema:'opsle.capability-result.v1',capability:manifest.id,hook,
output_schema:'opsle.capability.ack.v1',status:'ok',value:null,receipts:[],events:[]};
}};}`);
  const stdout = [...Array.from({ length: 112 }, (_, i) => `✔ task-${i}-${'success-detail-'.repeat(8)} (1.25ms)`),
    ...Array.from({ length: 3 }, (_, i) => `﹣ external-${i} (0.1ms) # SKIP`),
    'ℹ tests 115', 'ℹ suites 0', 'ℹ pass 112', 'ℹ fail 0', 'ℹ cancelled 0', 'ℹ skipped 3',
    'ℹ todo 0', 'ℹ duration_ms 12000', ''].join('\n');
  let sequence = 0;
  function run({ grants = [id, 'fixture.receipts'], selection = {}, repository = cliRoot,
    maxBytes = 12000, output = stdout, code = 0, discoverOnly = false } = {}) {
    const logsDir = resolve(temporary, `logs-${sequence++}`);
    mkdirSync(logsDir);
    const stdoutPath = resolve(logsDir, 'raw.stdout');
    const stderrPath = resolve(logsDir, 'raw.stderr');
    writeFileSync(stdoutPath, output); writeFileSync(stderrPath, '');
    const env = { ...process.env, OPSLE_CONTEXT_FIREWALL_MAX_BYTES: String(maxBytes) };
    delete env.OPSLE_CONTEXT_FIREWALL_REPO;
    delete env.NODE_OPTIONS;
    if (repository !== null) env.OPSLE_CONTEXT_FIREWALL_REPO = repository;
    const child = spawnSync(process.execPath, [resolve(fixtures, 'harness.mjs')], {
      cwd: temporary, env, encoding: 'utf8', maxBuffer: 4_000_000,
      input: JSON.stringify({ loader, config: { root: temporary, capabilityRoots: [installed, observer], logsDir },
        grants, selection: { enable: ['fixture.receipts'], ...selection }, discoverOnly,
        payload: { schema: 'opsle.execution.command-run.v1', taskId: 22, phase: 'TEST', sourceId: 'compatibility',
          run: { code, durationMs: 12000, interrupted: false, stdout: output, stderr: '', stdoutPath, stderrPath } } }),
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    return { ...JSON.parse(child.stdout), logsDir };
  }
  const inactive = run({ grants: [], selection: { enable: [] }, discoverOnly: true });
  assert.ok(inactive.discovered.some(item => item.id === id));
  assert.deepEqual(inactive.active, []);
  assert.match(run({ grants: [], selection: { enable: [] } }).error, /found 0/);
  assert.match(run({ selection: { enable: [id] } }).error, /authority ownership is operator-controlled/);
  assert.match(run({ selection: { disable: [id] } }).error, /authority ownership is operator-controlled/);
  assert.match(run({ repository: null }).error, /requires configuration/);
  assert.match(run({ repository: resolve(temporary, 'missing') }).error, /unavailable/);
  assert.match(run({ selection: { configuration: { [id]: {
    schema: manifest.configuration_schema, repository: '/untrusted',
  } } } }).error, /operator-controlled/);
  const passed = run();
  assert.equal(passed.error, undefined);
  assert.ok(passed.active.includes(id));
  const evidence = passed.results;
  const model = evidence.decisionEvidence.value;
  assert.deepEqual(Object.keys(model).sort(), ['decision_evidence', 'operation_id', 'protocol_version']);
  assert.equal(model.protocol_version, 'opsle.context-firewall.model-evidence/v1');
  assert.equal(model.decision_evidence.status, 'passed');
  assert.deepEqual(model.decision_evidence.counts, { passed: 112, failed: 0, skipped: 3, total: 115 });
  assert.deepEqual(model.decision_evidence, evidence.auditEvidence.value.decision_evidence);
  assert.deepEqual(JSON.parse(evidence.decisionEvidence.text), model);
  assert.equal(read(evidence.decisionEvidence.path), evidence.decisionEvidence.text);
  assert.equal(read(evidence.auditEvidence.path), evidence.auditEvidence.text);
  assert.notEqual(evidence.decisionEvidence.path, evidence.auditEvidence.path);
  assert.ok(Buffer.byteLength(evidence.auditEvidence.text) <= 12000);
  assert.equal(evidence.auditEvidence.metrics.originalBytes, Buffer.byteLength(stdout));
  assert.ok(evidence.auditEvidence.metrics.modelEvidenceBytes < evidence.auditEvidence.metrics.reducedBytes);
  assert.equal(evidence.auditEvidence.value.receipt.source.run_id, 'isolated-compatibility');
  const receipt = json(resolve(passed.logsDir, 'private-receipt.json'));
  assert.equal(receipt.extensions.opsle_tasks_delivery.model_evidence, 'constructed');
  assert.equal(receipt.extensions.opsle_tasks_delivery.canonical_packet, 'stored');
  for (const metric of ['initial_model_visible_bytes', 'bytes_initially_avoided', 'initial_reduction_ratio']) {
    assert.equal(receipt.measurements.find(item => item.id === metric).operator_display, false);
  }
  const producerReceiptPath = resolve(passed.logsDir, `${model.operation_id}.value-receipt.json`);
  // CLI sidecars and adapter artifacts must all be created with private permissions.
  for (const path of [evidence.decisionEvidence.path, evidence.auditEvidence.path, producerReceiptPath,
    resolve(passed.logsDir, 'private-receipt.json')]) {
    assert.equal(statSync(path).mode & 0o777, 0o600);
  }
  const raw = run({ output: 'unrecognized failure\n', code: 1 });
  assert.equal(raw.error, undefined);
  assert.equal(raw.results.decisionEvidence.value.decision_evidence.disposition, 'NEEDS_RAW_EVIDENCE');
  assert.match(raw.results.summary, /requires the retained raw evidence/);
  assert.ok(raw.results.auditEvidence.value.receipt.raw_evidence.reference.includes('raw.stdout'));
  const bounded = run({ output: `${stdout}WARNING: ${'bounded-warning'.repeat(1500)}\n`, maxBytes: 6000 });
  assert.equal(bounded.error, undefined);
  assert.ok(Buffer.byteLength(bounded.results.auditEvidence.text) <= 6000);
  assert.equal(bounded.results.decisionEvidence.value.decision_evidence.disposition, 'NEEDS_RAW_EVIDENCE');
  assert.ok(bounded.results.decisionEvidence.value.decision_evidence.reason_codes
    .includes('PAYLOAD_LIMIT_OMITTED_NONCRITICAL_TEXT'));
  // Adapt the pinned invocation/projection forgery checks to the installed package.
  const forgedRepo = resolve(temporary, 'forged-firewall');
  mkdirSync(resolve(forgedRepo, 'bin'), { recursive: true });
  const forgedCLI = resolve(forgedRepo, 'bin/context-firewall.js');
  for (const fault of ['invocation', 'projection']) {
    writeFileSync(forgedCLI, `const fs = require('node:fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const packet = {protocol_version:'opsle.context-firewall.evidence-packet/v1',
operation_id: ${fault === 'invocation' ? "'wrong-operation'" : 'input.operation_id'},
decision_evidence:{status:'failed',process:input.process},
receipt:{source:{id:input.source.id,run_id:input.source.run_id},raw_evidence:{reference:input.source.raw_evidence_ref}}};
const model = {protocol_version:'opsle.context-firewall.model-evidence/v1',
operation_id:packet.operation_id,decision_evidence:packet.decision_evidence,audit_metadata:'private'};
fs.writeFileSync(process.argv[process.argv.indexOf('--model-evidence')+1],JSON.stringify(model));
process.stdout.write(JSON.stringify(packet));`);
    const rejected = run({ repository: forgedRepo });
    assert.match(rejected.error, fault === 'invocation' ? /different command invocation/ : /inconsistent model evidence/);
    assert.equal(rejected.owner.component, id);
  }
  const impossible = run({ maxBytes: 64 });
  assert.match(impossible.error, /PAYLOAD_CEILING_TOO_SMALL/);
  assert.equal(impossible.code, 'CAPABILITY_FAILURE');
  assert.equal(impossible.owner.component, id);
  assert.deepEqual(readdirSync(impossible.logsDir).sort(), ['raw.stderr', 'raw.stdout']);
  assert.match(run({ grants: [], selection: { enable: [] } }).error, /found 0/); // operator revoke
  npm(['uninstall', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', packageName], installRoot);
  assert.ok(!existsSync(installed));
  assert.ok(!run({ discoverOnly: true }).discovered.some(item => item.id === id));
  assert.match(run().error, /found 0/);
  install(archive);
  assert.equal(run().results.decisionEvidence.value.decision_evidence.status, 'passed');
  // A synthetic compatible patch release exercises replacement and ESM cache restart semantics.
  const upgradeSource = resolve(temporary, 'upgrade-source');
  cpSync(packageSource, upgradeSource, { recursive: true });
  for (const file of ['package.json', 'opsle-capability.json']) {
    const path = resolve(upgradeSource, file); const value = json(path);
    value.version = '0.1.1'; writeFileSync(path, JSON.stringify(value));
  }
  const upgradedAdapter = resolve(upgradeSource, 'adapter.js');
  writeFileSync(upgradedAdapter, `${read(upgradedAdapter)}\n// Synthetic compatible patch fixture.\n`);
  install(pack(upgradeSource));
  const upgraded = run();
  assert.equal(upgraded.error, undefined);
  assert.equal(upgraded.discovered.find(item => item.id === id).version, '0.1.1');
  assert.deepEqual(upgraded.results.decisionEvidence.value.decision_evidence, model.decision_evidence);
  const upgradedEvent = upgraded.events.filter(event => event.kind === 'CAPABILITY')
    .map(event => JSON.parse(event.message)).find(event => event.id === id);
  assert.equal(upgradedEvent.implementation, `sha256:${sha256(readFileSync(upgradedAdapter))}`);
  assert.equal(upgradedEvent.version, '0.1.1');
  for (const [path, hash] of loaderBytes) assert.equal(sha256(readFileSync(path)), hash);
  for (const [path, hash] of Object.entries(provenance.sha256)) {
    assert.equal(sha256(readFileSync(resolve(fixtures, 'upstream', `${path}.txt`))), hash);
  }
});
