import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  INPUT_PROTOCOL,
  InputError,
  MODEL_EVIDENCE_PROTOCOL,
  PACKET_PROTOCOL,
  POLICY_REVISION,
  PayloadCeilingError,
  REDUCER_VERSION,
  canonicalJson,
  modelEvidenceForPacket,
  reduceTestRun,
  reduceWithValueReceipt,
  serializeModelEvidence,
  serializePacket,
} from '../src/reducer.js';
import { conformanceReport, corpus, executeFixture } from '../fixtures/corpus.js';
import {
  VALUE_RECEIPT_SCHEMA,
  formatContextFirewallIndicator,
} from '../src/value-receipt.js';

const cliPath = fileURLToPath(new URL('../bin/context-firewall.js', import.meta.url));

function fixture(name) {
  const value = corpus.find((item) => item.name === name);
  assert.ok(value, `missing fixture ${name}`);
  return value;
}

function valueMeasurement(receipt, id) {
  const value = receipt.measurements.find((item) => item.id === id);
  assert.ok(value, `missing value measurement ${id}`);
  return value;
}

test('rejects an unsupported input protocol', () => {
  assert.throws(
    () => reduceTestRun({ protocol_version: 'other', streams: [] }),
    (error) => error instanceof InputError && error.code === 'INVALID_INPUT',
  );
});

test('same input and configuration produce byte-identical output', () => {
  const input = fixture('failure/stack-trace').input;
  const first = serializePacket(reduceTestRun(input, { maxOutputBytes: 10_000 }));
  const second = serializePacket(reduceTestRun(input, { maxOutputBytes: 10_000 }));
  assert.deepEqual(first, second);
});

test('canonical output contains no generated time or random identity', () => {
  const packet = reduceTestRun(fixture('normal/small-all-pass').input);
  const output = serializePacket(packet).toString('utf8');
  assert.equal(/timestamp|created_at|generated_at|random|uuid/i.test(output), false);
  assert.equal(packet.operation_id, 'op-synthetic-001');
});

test('model evidence is an explicit semantic-only projection', () => {
  const packet = reduceTestRun(fixture('failure/stack-trace').input);
  const projection = modelEvidenceForPacket(packet);
  const output = serializeModelEvidence(projection);
  assert.deepEqual(projection, {
    decision_evidence: packet.decision_evidence,
    operation_id: packet.operation_id,
    protocol_version: MODEL_EVIDENCE_PROTOCOL,
  });
  assert.equal('receipt' in projection, false);
  assert.equal(output.toString('utf8'), `${canonicalJson(projection)}\n`);
  assert.ok(output.length < serializePacket(packet).length);
  assert.throws(
    () => modelEvidenceForPacket({ protocol_version: PACKET_PROTOCOL }),
    (error) => error instanceof InputError && error.code === 'INVALID_INPUT',
  );
});

test('packet identifies exact protocol, reducer, policy, and configuration', () => {
  const packet = reduceTestRun(fixture('normal/small-all-pass').input);
  assert.equal(packet.protocol_version, PACKET_PROTOCOL);
  assert.equal(packet.receipt.reducer.version, REDUCER_VERSION);
  assert.equal(packet.receipt.configuration.policy_revision, POLICY_REVISION);
  assert.match(packet.receipt.configuration.identity, /^sha256:[0-9a-f]{64}$/);
});

test('large all-pass output is substantially reduced with correct aggregates', () => {
  const packet = reduceTestRun(fixture('normal/large-all-pass').input);
  assert.deepEqual(packet.decision_evidence.counts, { passed: 1500, failed: 0, skipped: 0, total: 1500 });
  assert.equal(packet.decision_evidence.status, 'passed');
  assert.ok(packet.receipt.measurements.reduced_bytes < packet.receipt.measurements.original_bytes * 0.5);
  assert.equal(packet.receipt.suppressed.categories.successful_test, 1500);
});

test('Node spec output retains counts and diagnostics without retaining passing repetition', () => {
  const task16 = fixture('normal/node-spec-task-16');
  const packet = reduceTestRun(task16.input, task16.options);
  const packetBytes = serializePacket(packet).length;
  const modelBytes = serializeModelEvidence(modelEvidenceForPacket(packet)).length;
  assert.deepEqual(packet.decision_evidence.counts,
    { passed: 112, failed: 0, skipped: 3, total: 115 });
  assert.equal(packet.decision_evidence.status, 'passed');
  assert.equal(packet.decision_evidence.disposition, 'SUFFICIENT');
  assert.equal(packet.decision_evidence.unclassified_evidence.length, 0);
  assert.equal(packet.receipt.suppressed.categories.successful_test, 112);
  assert.equal(packet.receipt.suppressed.categories.skipped_test, 3);
  assert.ok(packetBytes <= 12_000);
  assert.ok(modelBytes < packetBytes);
  assert.ok(packetBytes < packet.receipt.measurements.original_bytes);

  const failure = reduceTestRun(fixture('failure/node-spec').input);
  assert.equal(failure.decision_evidence.status, 'failed');
  assert.equal(failure.decision_evidence.failures[0].identity, 'adds values');
  assert.ok(failure.decision_evidence.failures[0].details
    .some(item => item.text.includes('file:///public/test.js:4:5')));
});

test('a failed test retains identity, message, assertion, and location', () => {
  const packet = reduceTestRun(fixture('failure/one').input);
  const [failure] = packet.decision_evidence.failures;
  assert.equal(failure.identity, 'adds values');
  assert.equal(failure.header.category, 'failed_test');
  assert.deepEqual(failure.details.map((item) => item.category), [
    'failure_message', 'assertion', 'assertion',
  ]);
  assert.equal(failure.details[0].text.includes('expected two'), true);
});

test('multiple failures remain independent and ordered', () => {
  const packet = reduceTestRun(fixture('failure/several').input);
  assert.deepEqual(packet.decision_evidence.failures.map((failure) => failure.identity), [
    'first', 'second', 'third',
  ]);
  assert.equal(packet.decision_evidence.counts.failed, 3);
});

test('pass, fail, and skipped counts are aggregated correctly', () => {
  const mixed = reduceTestRun(fixture('failure/mixed-pass-fail').input);
  const skipped = reduceTestRun(fixture('normal/skipped-tests').input);
  assert.deepEqual(mixed.decision_evidence.counts, { passed: 2, failed: 1, skipped: 0, total: 3 });
  assert.deepEqual(skipped.decision_evidence.counts, { passed: 1, failed: 0, skipped: 2, total: 3 });
});

test('failure stack lines retain their classified evidence', () => {
  const packet = reduceTestRun(fixture('failure/stack-trace').input);
  const details = packet.decision_evidence.failures[0].details;
  assert.equal(details.some((item) => item.category === 'stack_trace'), true);
  assert.equal(details.some((item) => item.text.trim() === '---'), true);
  assert.equal(details.some((item) => item.text.trim() === '...'), true);
  assert.equal(details.some((item) => item.text.includes('public/test.js:4:5')), true);
});

test('stdout and stderr provenance are distinct and hashed together', () => {
  const item = fixture('edge/mixed-stdout-stderr');
  const packet = reduceTestRun(item.input);
  assert.deepEqual(packet.receipt.source.streams.map((stream) => stream.name), ['stdout', 'stderr']);
  assert.match(packet.receipt.input_hash, /^sha256:[0-9a-f]{64}$/);
  const changed = structuredClone(item.input);
  changed.streams[1].data += 'WARNING: another\n';
  assert.notEqual(reduceTestRun(changed).receipt.input_hash, packet.receipt.input_hash);
});

test('ANSI is ignored for classification but retained in evidence bytes', () => {
  const packet = reduceTestRun(fixture('edge/ansi').input);
  assert.equal(packet.decision_evidence.failures[0].identity, 'colored failure');
  assert.equal(packet.decision_evidence.failures[0].details[0].text.includes('\u001b[31m'), true);
});

test('superficial PASS, FAIL, error, and warning words do not become verdicts', () => {
  const packet = reduceTestRun(fixture('edge/superficial-pass-fail').input);
  assert.equal(packet.decision_evidence.status, 'passed');
  assert.equal(packet.decision_evidence.failures.length, 0);
  assert.equal(packet.decision_evidence.warnings.length, 0);
});

test('runner crash and timeout evidence are explicit', () => {
  const crash = reduceTestRun(fixture('process/runner-crash').input);
  const timeout = reduceTestRun(fixture('process/timeout').input);
  assert.equal(crash.decision_evidence.fatal_errors.length, 1);
  assert.equal(crash.decision_evidence.process.exit_code, 2);
  assert.equal(timeout.decision_evidence.timeouts.length, 1);
  assert.equal(timeout.decision_evidence.process.exit_code, 124);
});

test('unexplained nonzero exit requires raw evidence', () => {
  const packet = reduceTestRun(fixture('process/nonzero-unrecognized').input);
  assert.equal(packet.decision_evidence.status, 'failed');
  assert.equal(packet.decision_evidence.disposition, 'NEEDS_RAW_EVIDENCE');
  assert.ok(packet.decision_evidence.reason_codes.includes('NONZERO_EXIT_WITHOUT_RECOGNIZED_FAILURE'));
});

test('interrupted output retains recognized evidence and escalates', () => {
  const packet = reduceTestRun(fixture('process/interrupted-truncated').input);
  assert.equal(packet.decision_evidence.failures[0].details[0].text.includes('cut off'), true);
  assert.ok(packet.decision_evidence.reason_codes.includes('INTERRUPTED_OUTPUT'));
  assert.equal(packet.receipt.reduction_complete, false);
});

test('malformed and ambiguous text cannot become false certainty', () => {
  const packet = reduceTestRun(fixture('edge/malformed-output').input);
  assert.equal(packet.decision_evidence.status, 'indeterminate');
  assert.equal(packet.decision_evidence.disposition, 'NEEDS_RAW_EVIDENCE');
  assert.equal(packet.receipt.unclassified_evidence_present, true);
  assert.equal(packet.decision_evidence.unclassified_evidence.length, 2);
});

test('contradictory TAP aggregates require raw evidence', () => {
  const input = structuredClone(fixture('normal/small-all-pass').input);
  input.streams[0].data = input.streams[0].data.replace('# pass 2', '# pass 1');
  const packet = reduceTestRun(input);
  assert.equal(packet.decision_evidence.status, 'indeterminate');
  assert.ok(packet.decision_evidence.reason_codes.includes('AGGREGATE_CONTRADICTION'));
  assert.equal(packet.decision_evidence.disposition, 'NEEDS_RAW_EVIDENCE');
});

test('invalid UTF-8 is hash-addressed and escalated, never dropped', () => {
  const input = structuredClone(fixture('normal/small-all-pass').input);
  input.streams = [{ name: 'stdout', encoding: 'base64', data: Buffer.from([0xff, 0xfe]).toString('base64') }];
  const packet = reduceTestRun(input);
  assert.equal(packet.decision_evidence.status, 'indeterminate');
  assert.ok(packet.decision_evidence.reason_codes.includes('MALFORMED_UTF8'));
  assert.equal(packet.decision_evidence.unclassified_evidence[0].byte_count, undefined);
  assert.match(packet.decision_evidence.unclassified_evidence[0].text, /non-UTF-8 2 bytes/);
});

test('missing raw reference is distinct from reducer destruction', () => {
  const packet = reduceTestRun(fixture('provenance/raw-reference-absent').input);
  assert.equal(packet.decision_evidence.disposition, 'NEEDS_RAW_EVIDENCE');
  assert.equal(packet.receipt.raw_evidence.escalation_available, false);
  assert.equal(packet.receipt.raw_evidence.source_evidence_disposition, 'PRESERVATION_UNCONFIRMED');
  assert.equal(packet.receipt.raw_evidence.destroyed_by_reducer, false);
});

test('missing source identity is explicit and indeterminate', () => {
  const packet = reduceTestRun(fixture('provenance/source-missing').input);
  assert.equal(packet.receipt.source.id, null);
  assert.ok(packet.decision_evidence.reason_codes.includes('SOURCE_IDENTITY_MISSING'));
  assert.equal(packet.decision_evidence.status, 'indeterminate');
});

test('missing operation and exit identities fail closed', () => {
  const input = structuredClone(fixture('normal/small-all-pass').input);
  delete input.operation_id;
  input.process.exit_code = null;
  const packet = reduceTestRun(input);
  assert.equal(packet.decision_evidence.status, 'indeterminate');
  assert.ok(packet.decision_evidence.reason_codes.includes('OPERATION_ID_MISSING'));
  assert.ok(packet.decision_evidence.reason_codes.includes('EXIT_STATUS_MISSING'));
});

test('an exact payload boundary is honored byte for byte', () => {
  const result = executeFixture(fixture('payload/exact-boundary'));
  assert.equal(result.pass, true);
  assert.equal(serializePacket(result.packet).length, result.options.maxOutputBytes);
  assert.equal(result.packet.receipt.payload_limit.affected, false);
});

test('payload pressure never silently truncates critical evidence', () => {
  const item = fixture('payload/critical-too-large');
  const packet = reduceTestRun(item.input, item.options);
  const output = serializePacket(packet);
  assert.ok(output.length <= item.options.maxOutputBytes);
  assert.equal(packet.decision_evidence.disposition, 'NEEDS_RAW_EVIDENCE');
  assert.ok(packet.decision_evidence.reason_codes.includes('PAYLOAD_LIMIT_CRITICAL_EVIDENCE_EXCEEDED'));
  assert.equal(packet.decision_evidence.failures[0].identity, 'oversized-critical');
  assert.equal('details' in packet.decision_evidence.failures[0], false);
  assert.equal(packet.receipt.payload_limit.affected, true);
});

test('payload priority replaces warning text with an addressable reference first', () => {
  const input = structuredClone(fixture('normal/small-all-pass').input);
  input.streams[0].data += `WARNING: ${'bounded-warning'.repeat(600)}\n`;
  const packet = reduceTestRun(input, { maxOutputBytes: 3_000 });
  assert.equal(packet.decision_evidence.status, 'passed');
  assert.equal(packet.decision_evidence.disposition, 'NEEDS_RAW_EVIDENCE');
  assert.ok(packet.decision_evidence.reason_codes.includes('PAYLOAD_LIMIT_OMITTED_NONCRITICAL_TEXT'));
  assert.equal(packet.decision_evidence.warnings.length, 1);
  assert.equal('text' in packet.decision_evidence.warnings[0], false);
  assert.ok(packet.decision_evidence.warnings[0].byte_count > 3_000);
  assert.ok(serializePacket(packet).length <= 3_000);
});

test('a ceiling below the safe packet size fails with machine details and no packet', () => {
  const item = fixture('payload/safe-packet-impossible');
  assert.throws(
    () => reduceTestRun(item.input, item.options),
    (error) => error instanceof PayloadCeilingError
      && error.details.disposition === 'NEEDS_RAW_EVIDENCE'
      && error.details.minimum_safe_packet_bytes > item.options.maxOutputBytes,
  );
});

test('original and reduced byte and event measurements are exact', () => {
  const input = fixture('normal/small-all-pass').input;
  const packet = reduceTestRun(input);
  const output = serializePacket(packet);
  const expectedInputBytes = input.streams.reduce((sum, stream) => sum + Buffer.byteLength(stream.data), 0);
  assert.equal(packet.receipt.measurements.original_bytes, expectedInputBytes);
  assert.equal(packet.receipt.measurements.reduced_bytes, output.length);
  assert.equal(
    packet.receipt.measurements.retained_evidence_count + packet.receipt.measurements.suppressed_evidence_count,
    packet.receipt.measurements.original_event_count,
  );
});

test('emits the complete opsle.value-receipt.v1 Context Firewall profile', () => {
  const { valueReceipt: receipt } = reduceWithValueReceipt(fixture('normal/large-all-pass').input);
  assert.equal(receipt.schema, VALUE_RECEIPT_SCHEMA);
  assert.deepEqual(receipt.mechanism, {
    id: 'opsle.context-firewall',
    name: 'Context Firewall',
    revision: null,
    version: REDUCER_VERSION,
  });
  assert.equal(receipt.run.id, 'run-001');
  assert.equal(receipt.operation.id, 'op-synthetic-001');
  assert.equal(receipt.operation.name, 'test-output-reduction');
  assert.equal(receipt.operation.policy_id, POLICY_REVISION);
  assert.match(receipt.operation.configuration_id, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(receipt.measurements.map((item) => item.id), [
    'raw_bytes',
    'initial_model_visible_bytes',
    'bytes_initially_avoided',
    'initial_reduction_ratio',
    'original_evidence_events',
    'retained_evidence_events',
    'suppressed_evidence_events',
    'ambiguous_evidence_events',
    'payload_ceiling_bytes',
    'escalation_required',
    'raw_locator_available',
  ]);
  assert.equal(receipt.evidence.every((item) => item.id && item.kind && item.locator && item.trust), true);
  assert.equal(new Set(receipt.evidence.map((item) => item.id)).size, receipt.evidence.length);
  for (const item of receipt.measurements.filter((value) => value.class === 'EXACT')) {
    assert.equal(item.source_verification, 'VERIFIED');
    assert.equal(item.derivation, null);
  }
});

test('caller-supplied mechanism revision affects only the deterministic value receipt', () => {
  const input = fixture('normal/large-all-pass').input;
  const revision = 'dd34bd9f681314761f1ca87f339648bf611811f3';
  const first = reduceWithValueReceipt(input, { mechanismRevision: revision });
  const second = reduceWithValueReceipt(input, { mechanismRevision: revision });
  assert.equal(first.valueReceipt.mechanism.revision, revision);
  assert.equal(canonicalJson(first.valueReceipt), canonicalJson(second.valueReceipt));
  assert.deepEqual(serializePacket(first.packet), serializePacket(reduceTestRun(input)));
  assert.equal('value_receipt' in first.packet, false);
  assert.throws(
    () => reduceWithValueReceipt(input, { mechanismRevision: '' }),
    (error) => error instanceof InputError && error.code === 'INVALID_INPUT',
  );
});

test('value receipt byte deltas, ratio, and event partition are exact', () => {
  const { packet, valueReceipt } = reduceWithValueReceipt(fixture('normal/large-all-pass').input);
  const outputBytes = serializePacket(packet).length;
  const raw = valueMeasurement(valueReceipt, 'raw_bytes');
  const visible = valueMeasurement(valueReceipt, 'initial_model_visible_bytes');
  const avoided = valueMeasurement(valueReceipt, 'bytes_initially_avoided');
  const ratio = valueMeasurement(valueReceipt, 'initial_reduction_ratio');
  assert.equal(raw.result, packet.receipt.measurements.original_bytes);
  assert.deepEqual(
    [visible.baseline, visible.result, visible.delta],
    [raw.result, outputBytes, outputBytes - raw.result],
  );
  assert.deepEqual(
    [avoided.baseline, avoided.result, avoided.delta],
    [outputBytes, raw.result, raw.result - outputBytes],
  );
  assert.equal(ratio.result, `${raw.result - outputBytes}/${raw.result}`);
  assert.deepEqual(ratio.aggregation, { method: null, safe: false });
  assert.equal(
    valueMeasurement(valueReceipt, 'retained_evidence_events').result
      + valueMeasurement(valueReceipt, 'suppressed_evidence_events').result,
    valueMeasurement(valueReceipt, 'original_evidence_events').result,
  );
});

test('value receipt preserves expansion instead of fabricating avoided bytes', () => {
  const { valueReceipt } = reduceWithValueReceipt(fixture('normal/small-all-pass').input);
  const avoided = valueMeasurement(valueReceipt, 'bytes_initially_avoided');
  assert.ok(avoided.delta < 0);
  assert.equal(avoided.delta, avoided.result - avoided.baseline);
  assert.equal(
    formatContextFirewallIndicator(valueReceipt),
    '[Context Firewall] 104 B -> 1,825 B | 1,721 B expansion | escalation: no',
  );
});

test('value receipt exposes reduction and the exact named operator indicator', () => {
  const { valueReceipt } = reduceWithValueReceipt(fixture('normal/large-all-pass').input);
  assert.equal(
    formatContextFirewallIndicator(valueReceipt),
    '[Context Firewall] 28,981 B -> 1,847 B | 27,134 B initially avoided (93.63%) | escalation: no',
  );
});

test('value receipt records ambiguity, escalation, and raw-locator trust', () => {
  const { valueReceipt } = reduceWithValueReceipt(fixture('edge/malformed-output').input);
  assert.equal(valueMeasurement(valueReceipt, 'ambiguous_evidence_events').result, 2);
  assert.deepEqual(
    {
      class: valueMeasurement(valueReceipt, 'escalation_required').class,
      result: valueMeasurement(valueReceipt, 'escalation_required').result,
    },
    { class: 'OBSERVED', result: true },
  );
  const locator = valueMeasurement(valueReceipt, 'raw_locator_available');
  assert.equal(locator.result, true);
  assert.equal(locator.source_verification, 'CALLER_SUPPLIED');
  assert.equal(valueReceipt.evidence.find((item) => item.id === 'raw_locator').trust, 'CALLER_SUPPLIED');
});

test('missing raw locator and zero-byte ratio remain explicitly unavailable', () => {
  const input = structuredClone(fixture('normal/small-all-pass').input);
  input.streams[0].data = '';
  delete input.source.raw_evidence_ref;
  const { valueReceipt } = reduceWithValueReceipt(input);
  assert.equal(valueMeasurement(valueReceipt, 'raw_bytes').result, 0);
  assert.equal(valueMeasurement(valueReceipt, 'initial_reduction_ratio').result, null);
  assert.equal(valueMeasurement(valueReceipt, 'raw_locator_available').result, false);
  assert.equal(valueMeasurement(valueReceipt, 'escalation_required').result, true);
  assert.equal(valueReceipt.evidence.some((item) => item.id === 'raw_locator'), false);
  assert.ok(valueReceipt.limitations.includes('No raw evidence locator was supplied.'));
});

test('payload ceiling value remains exact configuration and is never summed', () => {
  const item = fixture('payload/comfortably-above');
  const { valueReceipt } = reduceWithValueReceipt(item.input, item.options);
  const ceiling = valueMeasurement(valueReceipt, 'payload_ceiling_bytes');
  assert.equal(ceiling.result, item.options.maxOutputBytes);
  assert.deepEqual(ceiling.aggregation, { method: null, safe: false });
});

test('duration is caller-supplied semantic evidence and no runtime latency is hashed', () => {
  const packet = reduceTestRun(fixture('normal/small-all-pass').input);
  assert.equal(packet.decision_evidence.process.duration_ms, 12.5);
  assert.equal('processing_latency_ms' in packet.receipt.measurements, false);
});

test('missing final newline has an exact event count', () => {
  const item = fixture('edge/missing-final-newline');
  const packet = reduceTestRun(item.input);
  assert.equal(packet.receipt.measurements.original_event_count, item.input.streams[0].data.split('\n').length);
});

test('CLI reads JSON from stdin and emits the canonical packet', () => {
  const input = fixture('normal/small-all-pass').input;
  const result = spawnSync(process.execPath, [cliPath, 'reduce'], {
    encoding: 'utf8',
    input: JSON.stringify(input),
  });
  assert.equal(result.status, 0, result.stderr);
  const expected = serializePacket(reduceTestRun(input)).toString('utf8');
  assert.equal(result.stdout, expected);
  assert.equal('value_receipt' in JSON.parse(result.stdout), false);
  assert.equal(
    result.stderr,
    `${formatContextFirewallIndicator(reduceWithValueReceipt(input).valueReceipt)}\n`,
  );
});

test('CLI writes a canonical value receipt only to an explicitly requested sidecar', () => {
  const input = fixture('normal/large-all-pass').input;
  const directory = mkdtempSync(join(tmpdir(), 'context-firewall-value-'));
  const modelEvidencePath = join(directory, 'model-evidence.json');
  const receiptPath = join(directory, 'value-receipt.json');
  const revision = 'dd34bd9f681314761f1ca87f339648bf611811f3';
  try {
    const result = spawnSync(process.execPath, [
      cliPath,
      'reduce',
      '--mechanism-revision',
      revision,
      '--model-evidence',
      modelEvidencePath,
      '--value-receipt',
      receiptPath,
    ], {
      encoding: 'utf8',
      input: JSON.stringify(input),
    });
    assert.equal(result.status, 0, result.stderr);
    const { packet, valueReceipt } = reduceWithValueReceipt(input, {
      mechanismRevision: revision,
    });
    assert.equal(result.stdout, serializePacket(packet).toString('utf8'));
    assert.equal(readFileSync(receiptPath, 'utf8'), `${canonicalJson(valueReceipt)}\n`);
    assert.equal(
      readFileSync(modelEvidencePath, 'utf8'),
      serializeModelEvidence(modelEvidenceForPacket(packet)).toString('utf8'),
    );
    assert.equal(JSON.parse(readFileSync(receiptPath, 'utf8')).schema, VALUE_RECEIPT_SCHEMA);
    assert.equal(JSON.parse(readFileSync(modelEvidencePath, 'utf8')).protocol_version, MODEL_EVIDENCE_PROTOCOL);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('CLI reports malformed JSON as a machine-readable error', () => {
  const result = spawnSync(process.execPath, [cliPath, 'reduce'], {
    encoding: 'utf8',
    input: '{broken',
  });
  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stderr), {
    code: 'INVALID_INPUT',
    message: 'input must be valid JSON',
  });
  assert.equal(result.stdout, '');
});

test('CLI keeps an impossible-ceiling error off model-visible stdout', () => {
  const item = fixture('payload/safe-packet-impossible');
  const result = spawnSync(process.execPath, [cliPath, 'reduce', '--max-bytes', '64'], {
    encoding: 'utf8',
    input: JSON.stringify(item.input),
  });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr);
  assert.equal(error.code, 'PAYLOAD_CEILING_TOO_SMALL');
  assert.equal(error.disposition, 'NEEDS_RAW_EVIDENCE');
});

test('all 33 synthetic fixtures conform', () => {
  const report = conformanceReport();
  assert.equal(report.fixture_count, 33);
  assert.equal(report.conformance, 'PASS');
  assert.equal(report.fixtures.every((item) => item.conformance === 'PASS'), true);
});

test('conformance output is deterministic', () => {
  assert.equal(canonicalJson(conformanceReport()), canonicalJson(conformanceReport()));
});
