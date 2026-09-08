import {
  INPUT_PROTOCOL,
  PayloadCeilingError,
  reduceTestRun,
  reduceWithValueReceipt,
  serializePacket,
} from '../src/reducer.js';

function tap({ passed = [], failed = [], skipped = [], extras = [], finalNewline = true }) {
  const lines = ['TAP version 13'];
  let index = 1;
  for (const name of passed) lines.push(`ok ${index++} - ${name}`);
  for (const name of skipped) lines.push(`ok ${index++} - ${name} # SKIP synthetic`);
  for (const failure of failed) {
    lines.push(`not ok ${index++} - ${failure.name}`);
    lines.push(...(failure.details ?? []).map((detail) => `  ${detail}`));
  }
  lines.push(...extras);
  lines.push(`1..${passed.length + failed.length + skipped.length}`);
  lines.push(`# tests ${passed.length + failed.length + skipped.length}`);
  lines.push(`# pass ${passed.length}`);
  lines.push(`# fail ${failed.length}`);
  lines.push(`# skipped ${skipped.length}`);
  lines.push('# duration_ms 12.5');
  return `${lines.join('\n')}${finalNewline ? '\n' : ''}`;
}

function nodeSpec({ passed = [], failed = [], skipped = [], extras = [] }) {
  const lines = [];
  for (const name of passed) lines.push(`✔ ${name} (1.25ms)`);
  for (const name of skipped) lines.push(`﹣ ${name} (0.1ms) # SKIP`);
  for (const failure of failed) {
    lines.push(`✖ ${failure.name} (2.5ms)`);
    lines.push(...(failure.details ?? []).map((detail) => `  ${detail}`));
  }
  lines.push(...extras);
  lines.push(`ℹ tests ${passed.length + failed.length + skipped.length}`);
  lines.push('ℹ suites 0');
  lines.push(`ℹ pass ${passed.length}`);
  lines.push(`ℹ fail ${failed.length}`);
  lines.push('ℹ cancelled 0');
  lines.push(`ℹ skipped ${skipped.length}`);
  lines.push('ℹ todo 0');
  lines.push('ℹ duration_ms 12.5');
  return `${lines.join('\n')}\n`;
}

function invocation({
  stdout = '', stderr = '', exitCode = 0, interrupted = false,
  source = true, rawRef = true, operationId = true, durationMs = 12.5,
} = {}) {
  const streams = [{ name: 'stdout', encoding: 'utf8', data: stdout }];
  if (stderr !== '') streams.push({ name: 'stderr', encoding: 'utf8', data: stderr });
  return {
    protocol_version: INPUT_PROTOCOL,
    ...(operationId ? { operation_id: 'op-synthetic-001' } : {}),
    source: {
      ...(source ? { id: 'synthetic-suite', run_id: 'run-001' } : {}),
      ...(rawRef ? { raw_evidence_ref: 'artifact://synthetic/run-001.tap' } : {}),
    },
    process: { exit_code: exitCode, duration_ms: durationMs, interrupted },
    streams,
  };
}

const manyPasses = Array.from({ length: 1500 }, (_, index) => `case-${String(index + 1).padStart(4, '0')}`);
const repetitivePasses = Array.from({ length: 400 }, () => 'repetitive-success');
const task16Passes = Array.from({ length: 112 }, (_, index) =>
  `task-16-case-${index + 1}-${'repetitive-success-detail-'.repeat(3)}`);
const longName = `very-long-${'x'.repeat(40_000)}`;
const longFailure = `message: ${'critical'.repeat(4_000)}`;

export const corpus = Object.freeze([
  { name: 'normal/small-all-pass', input: invocation({ stdout: tap({ passed: ['alpha', 'beta'] }) }), expected: { status: 'passed', disposition: 'SUFFICIENT', counts: [2, 0, 0] } },
  { name: 'normal/large-all-pass', input: invocation({ stdout: tap({ passed: manyPasses }) }), expected: { status: 'passed', disposition: 'SUFFICIENT', counts: [1500, 0, 0], substantialReduction: true } },
  { name: 'normal/repetitive-success', input: invocation({ stdout: tap({ passed: repetitivePasses }) }), expected: { status: 'passed', counts: [400, 0, 0], substantialReduction: true } },
  { name: 'normal/skipped-tests', input: invocation({ stdout: tap({ passed: ['runs'], skipped: ['not-applicable', 'platform-only'] }) }), expected: { status: 'passed', counts: [1, 0, 2] } },
  { name: 'normal/node-spec-task-16', input: invocation({ stdout: nodeSpec({ passed: task16Passes, skipped: ['external-a', 'external-b', 'external-c'], extras: ['> package@1.0.0 test', '> node --test', 'ℹ {"bounded":"diagnostic"}', 'Switched to a new branch \'feature\''] }) }), options: { maxOutputBytes: 12_000 }, expected: { status: 'passed', disposition: 'SUFFICIENT', counts: [112, 0, 3], substantialReduction: true } },
  { name: 'normal/node-dot-progress', input: invocation({ stdout: nodeSpec({ passed: ['alpha', 'beta'], extras: ['..'] }) }), expected: { status: 'passed', disposition: 'SUFFICIENT', counts: [2, 0, 0] } },
  { name: 'failure/one', input: invocation({ stdout: tap({ failed: [{ name: 'adds values', details: ['message: expected two', 'expected: 2', 'actual: 3'] }] }), exitCode: 1 }), expected: { status: 'failed', failures: 1, contains: ['adds values', 'expected two'] } },
  { name: 'failure/node-spec', input: invocation({ stdout: nodeSpec({ passed: ['green'], failed: [{ name: 'adds values', details: ['error: expected two', 'expected: 2', 'actual: 3', 'at test (file:///public/test.js:4:5)'] }] }), exitCode: 1 }), expected: { status: 'failed', disposition: 'SUFFICIENT', counts: [1, 1, 0], failures: 1, contains: ['adds values', 'expected two', 'file:///public/test.js:4:5'] } },
  { name: 'failure/several', input: invocation({ stdout: tap({ failed: [{ name: 'first', details: ['message: first broke'] }, { name: 'second', details: ['message: second broke'] }, { name: 'third', details: ['message: third broke'] }] }), exitCode: 1 }), expected: { status: 'failed', failures: 3, contains: ['first broke', 'second broke', 'third broke'] } },
  { name: 'failure/mixed-pass-fail', input: invocation({ stdout: tap({ passed: ['green-a', 'green-b'], failed: [{ name: 'red', details: ['message: broken'] }] }), exitCode: 1 }), expected: { status: 'failed', counts: [2, 1, 0], failures: 1 } },
  { name: 'failure/assertion-difference', input: invocation({ stdout: tap({ failed: [{ name: 'diffs objects', details: ['operator: deepStrictEqual', 'expected: {a: 1}', 'actual: {a: 2}', 'diff: -1 +2'] }] }), exitCode: 1 }), expected: { status: 'failed', contains: ['deepStrictEqual', 'diff: -1 +2'] } },
  { name: 'failure/stack-trace', input: invocation({ stdout: tap({ failed: [{ name: 'throws', details: ['---', 'error: synthetic failure', 'code: ERR_SYNTHETIC', 'stack: |', '  TypeError: synthetic failure', '  at subject (file:///public/example.js:2:3)', '  at test (file:///public/test.js:4:5)', '...'] }] }), exitCode: 1 }), expected: { status: 'failed', contains: ['TypeError: synthetic failure', 'file:///public/test.js:4:5'] } },
  { name: 'failure/independent-regions', input: invocation({ stdout: tap({ passed: ['between'], failed: [{ name: 'region-a', details: ['message: A'] }, { name: 'region-b', details: ['message: B'] }] }), exitCode: 1 }), expected: { status: 'failed', failures: 2, contains: ['region-a', 'region-b'] } },
  { name: 'process/runner-crash', input: invocation({ stdout: tap({ passed: ['before-crash'] }), stderr: 'FATAL: runner crashed synthetically\n', exitCode: 2 }), expected: { status: 'failed', fatal: 1, contains: ['runner crashed synthetically'] } },
  { name: 'process/nonzero-unrecognized', input: invocation({ stdout: '# note: process stopped without a test failure\n', exitCode: 2 }), expected: { status: 'failed', disposition: 'NEEDS_RAW_EVIDENCE', reason: 'NONZERO_EXIT_WITHOUT_RECOGNIZED_FAILURE' } },
  { name: 'process/timeout', input: invocation({ stdout: 'TIMEOUT: suite exceeded 5000ms\n', exitCode: 124 }), expected: { status: 'failed', timeout: 1, contains: ['suite exceeded 5000ms'] } },
  { name: 'process/interrupted-truncated', input: invocation({ stdout: 'TAP version 13\nnot ok 1 - incomplete\n  message: cut off', exitCode: 1, interrupted: true }), expected: { status: 'failed', disposition: 'NEEDS_RAW_EVIDENCE', reason: 'INTERRUPTED_OUTPUT', contains: ['cut off'] } },
  { name: 'edge/mixed-stdout-stderr', input: invocation({ stdout: tap({ passed: ['stdout-case'] }), stderr: 'WARNING: synthetic stderr warning\n' }), expected: { status: 'passed', warning: 1, streams: 2 } },
  { name: 'edge/ansi', input: invocation({ stdout: tap({ failed: [{ name: '\u001b[31mcolored failure\u001b[0m', details: ['message: \u001b[31mred\u001b[0m'] }] }), exitCode: 1 }), expected: { status: 'failed', failures: 1, contains: ['colored failure', 'red'] } },
  { name: 'edge/unicode', input: invocation({ stdout: tap({ failed: [{ name: 'unicode-λ-🧪', details: ['message: café ≠ чай'] }] }), exitCode: 1 }), expected: { status: 'failed', contains: ['unicode-λ-🧪', 'café ≠ чай'] } },
  { name: 'edge/very-long-line', input: invocation({ stdout: tap({ passed: [longName] }) }), expected: { status: 'passed', substantialReduction: true } },
  { name: 'edge/missing-final-newline', input: invocation({ stdout: tap({ passed: ['no-newline'] , finalNewline: false }) }), expected: { status: 'passed', counts: [1, 0, 0] } },
  { name: 'edge/repeated-identical-messages', input: invocation({ stdout: tap({ passed: ['still-green'], extras: Array.from({ length: 300 }, () => '# note: identical heartbeat') }) }), expected: { status: 'passed', substantialReduction: true } },
  { name: 'edge/malformed-output', input: invocation({ stdout: 'this is not TAP\nnot okay maybe FAIL\n' }), expected: { status: 'indeterminate', disposition: 'NEEDS_RAW_EVIDENCE', reason: 'UNCLASSIFIED_EVIDENCE' } },
  { name: 'edge/superficial-pass-fail', input: invocation({ stdout: tap({ passed: ['literal PASS FAIL error warning text'], extras: ['# note: PASS FAIL error warning are prose'] }) }), expected: { status: 'passed', failures: 0, warning: 0 } },
  { name: 'payload/comfortably-above', input: invocation({ stdout: tap({ failed: [{ name: 'bounded', details: ['message: retained'] }] }), exitCode: 1 }), options: { maxOutputBytes: 20_000 }, expected: { status: 'failed', failures: 1, payloadAffected: false } },
  { name: 'payload/exact-boundary', input: invocation({ stdout: tap({ passed: manyPasses }) }), ceilingMode: 'exact', expected: { status: 'passed', payloadAffected: false, substantialReduction: true } },
  { name: 'payload/critical-too-large', input: invocation({ stdout: tap({ failed: [{ name: 'oversized-critical', details: [longFailure] }] }), exitCode: 1 }), options: { maxOutputBytes: 3_500 }, expected: { status: 'failed', disposition: 'NEEDS_RAW_EVIDENCE', reason: 'PAYLOAD_LIMIT_CRITICAL_EVIDENCE_EXCEEDED', payloadAffected: true } },
  { name: 'payload/safe-packet-impossible', input: invocation({ stdout: tap({ failed: [{ name: 'cannot-fit', details: [longFailure] }] }), exitCode: 1 }), options: { maxOutputBytes: 64 }, expected: { ceilingError: true } },
  { name: 'provenance/raw-reference-present', input: invocation({ stdout: tap({ passed: ['addressable'] }) }), expected: { status: 'passed', disposition: 'SUFFICIENT', rawRef: true } },
  { name: 'provenance/raw-reference-absent', input: invocation({ stdout: tap({ passed: ['not-addressable'] }), rawRef: false }), expected: { status: 'passed', disposition: 'NEEDS_RAW_EVIDENCE', reason: 'RAW_EVIDENCE_REFERENCE_MISSING', rawRef: false } },
  { name: 'provenance/source-present', input: invocation({ stdout: tap({ passed: ['identified'] }) }), expected: { status: 'passed', source: true } },
  { name: 'provenance/source-missing', input: invocation({ stdout: tap({ passed: ['anonymous'] }), source: false }), expected: { status: 'indeterminate', disposition: 'NEEDS_RAW_EVIDENCE', reason: 'SOURCE_IDENTITY_MISSING', source: false } },
]);

function exactCeiling(input) {
  let ceiling = 100_000;
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const packet = reduceTestRun(input, { maxOutputBytes: ceiling });
    const size = serializePacket(packet).length;
    if (size === ceiling) return ceiling;
    ceiling = size;
  }
  throw new Error('exact ceiling did not converge');
}

export function executeFixture(fixture) {
  const options = fixture.ceilingMode === 'exact'
    ? { maxOutputBytes: exactCeiling(fixture.input) }
    : (fixture.options ?? {});
  try {
    const { packet, valueReceipt } = reduceWithValueReceipt(fixture.input, options);
    const bytes = serializePacket(packet);
    const evidence = packet.decision_evidence;
    const expected = fixture.expected;
    const text = bytes.toString('utf8');
    const checks = [];
    if (expected.ceilingError) checks.push(false);
    if (expected.status) checks.push(evidence.status === expected.status);
    if (expected.disposition) checks.push(evidence.disposition === expected.disposition);
    if (expected.counts) checks.push(
      evidence.counts.passed === expected.counts[0]
      && evidence.counts.failed === expected.counts[1]
      && evidence.counts.skipped === expected.counts[2],
    );
    if (expected.failures != null) checks.push(evidence.failures.length === expected.failures);
    if (expected.fatal != null) checks.push(evidence.fatal_errors.length === expected.fatal);
    if (expected.timeout != null) checks.push(evidence.timeouts.length === expected.timeout);
    if (expected.warning != null) checks.push(evidence.warnings.length === expected.warning);
    if (expected.reason) checks.push(evidence.reason_codes.includes(expected.reason));
    if (expected.contains) checks.push(expected.contains.every((needle) => text.includes(needle)));
    if (expected.payloadAffected != null) checks.push(packet.receipt.payload_limit.affected === expected.payloadAffected);
    if (expected.streams != null) checks.push(packet.receipt.source.streams.length === expected.streams);
    if (expected.rawRef != null) checks.push(packet.receipt.raw_evidence.escalation_available === expected.rawRef);
    if (expected.source != null) checks.push(Boolean(packet.receipt.source.id) === expected.source);
    if (expected.substantialReduction) checks.push(
      packet.receipt.measurements.reduced_bytes < packet.receipt.measurements.original_bytes * 0.5,
    );
    if (options.maxOutputBytes != null) checks.push(bytes.length <= options.maxOutputBytes);
    checks.push(packet.receipt.measurements.reduced_bytes === bytes.length);
    checks.push(valueReceipt.schema === 'opsle.value-receipt.v1');
    checks.push(valueReceipt.measurements.find(
      (measurement) => measurement.id === 'raw_bytes',
    )?.result === packet.receipt.measurements.original_bytes);
    checks.push(valueReceipt.measurements.find(
      (measurement) => measurement.id === 'initial_model_visible_bytes',
    )?.result === bytes.length);
    checks.push(valueReceipt.measurements.find(
      (measurement) => measurement.id === 'escalation_required',
    )?.result === packet.receipt.raw_evidence.escalation_required);
    checks.push(packet.receipt.measurements.original_bytes === fixture.input.streams.reduce(
      (sum, stream) => sum + Buffer.byteLength(stream.data, stream.encoding === 'base64' ? 'base64' : 'utf8'), 0,
    ));
    return { packet, valueReceipt, options, pass: checks.every(Boolean) };
  } catch (error) {
    if (error instanceof PayloadCeilingError && fixture.expected.ceilingError) {
      return { error, options, pass: true };
    }
    return { error, options, pass: false };
  }
}

export function conformanceReport() {
  const fixtures = corpus.map((fixture) => {
    const result = executeFixture(fixture);
    if (result.error) {
      return {
        conformance: result.pass ? 'PASS' : 'FAIL',
        escalation_required: true,
        fixture: fixture.name,
        raw_bytes: fixture.input.streams.reduce(
          (sum, stream) => sum + Buffer.byteLength(stream.data, stream.encoding === 'base64' ? 'base64' : 'utf8'),
          0,
        ),
        reduced_bytes: null,
        reduction_percentage: null,
        verdict_preserved: null,
      };
    }
    const packet = result.packet;
    return {
      conformance: result.pass ? 'PASS' : 'FAIL',
      critical_evidence_preserved: packet.decision_evidence.disposition === 'SUFFICIENT'
        || packet.receipt.raw_evidence.escalation_required,
      escalation_required: packet.receipt.raw_evidence.escalation_required,
      fixture: fixture.name,
      raw_bytes: packet.receipt.measurements.original_bytes,
      reduced_bytes: packet.receipt.measurements.reduced_bytes,
      reduction_percentage: packet.receipt.measurements.original_bytes === 0
        ? null
        : Number((
          (packet.receipt.measurements.original_bytes - packet.receipt.measurements.reduced_bytes)
          / packet.receipt.measurements.original_bytes
          * 100
        ).toFixed(2)),
      verdict_preserved: fixture.expected.status == null
        ? null
        : packet.decision_evidence.status === fixture.expected.status,
      value_receipt_schema: result.valueReceipt.schema,
    };
  });
  return {
    conformance: fixtures.every((fixture) => fixture.conformance === 'PASS') ? 'PASS' : 'FAIL',
    fixture_count: fixtures.length,
    fixtures,
    protocol_version: 'opsle.context-firewall.conformance/v1',
    value_receipt_schema: 'opsle.value-receipt.v1',
  };
}
