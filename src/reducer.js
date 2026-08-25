import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { buildReductionValueReceipt } from './value-receipt.js';

export const INPUT_PROTOCOL = 'opsle.context-firewall.test-run-input/v1';
export const PACKET_PROTOCOL = 'opsle.context-firewall.evidence-packet/v1';
export const REDUCER_NAME = '@opsle/context-firewall/test-output';
export const REDUCER_VERSION = '0.3.0';
export const POLICY_REVISION = 'tap-subset-policy/v1';

const ANSI_PATTERN = /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
const streamOrder = new Map([['stdout', 0], ['stderr', 1]]);

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
    this.code = 'INVALID_INPUT';
  }
}

export class PayloadCeilingError extends Error {
  constructor(details) {
    super('payload ceiling is too small for a safe evidence packet');
    this.name = 'PayloadCeilingError';
    this.code = 'PAYLOAD_CEILING_TOO_SMALL';
    this.details = details;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  const digest = createHash('sha256');
  digest.update(value);
  return `sha256:${digest.digest('hex')}`;
}

function decodeBase64(value) {
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new InputError('stream base64 data is invalid');
  }
  return Buffer.from(value, 'base64');
}

export function normalizeInvocation(value) {
  if (!isPlainObject(value)) throw new InputError('input object required');
  if (value.protocol_version !== INPUT_PROTOCOL) {
    throw new InputError(`protocol_version must be ${INPUT_PROTOCOL}`);
  }
  if (!Array.isArray(value.streams) || value.streams.length === 0) {
    throw new InputError('at least one stream is required');
  }

  const seen = new Set();
  const streams = value.streams.map((stream) => {
    if (!isPlainObject(stream) || !streamOrder.has(stream.name)) {
      throw new InputError('stream name must be stdout or stderr');
    }
    if (seen.has(stream.name)) throw new InputError(`duplicate ${stream.name} stream`);
    seen.add(stream.name);
    if (typeof stream.data !== 'string') throw new InputError('stream data must be a string');
    const encoding = stream.encoding ?? 'utf8';
    if (!['utf8', 'base64'].includes(encoding)) {
      throw new InputError('stream encoding must be utf8 or base64');
    }
    return {
      name: stream.name,
      bytes: encoding === 'base64' ? decodeBase64(stream.data) : Buffer.from(stream.data, 'utf8'),
    };
  }).sort((left, right) => streamOrder.get(left.name) - streamOrder.get(right.name));

  const source = isPlainObject(value.source) ? value.source : {};
  const process = isPlainObject(value.process) ? value.process : {};
  if (process.exit_code != null && (!Number.isInteger(process.exit_code) || process.exit_code < 0 || process.exit_code > 255)) {
    throw new InputError('process.exit_code must be an integer from 0 through 255 or null');
  }
  if (process.duration_ms != null && (typeof process.duration_ms !== 'number' || !Number.isFinite(process.duration_ms) || process.duration_ms < 0)) {
    throw new InputError('process.duration_ms must be a nonnegative finite number or null');
  }
  if (process.interrupted != null && typeof process.interrupted !== 'boolean') {
    throw new InputError('process.interrupted must be boolean when supplied');
  }

  return {
    protocolVersion: value.protocol_version,
    operationId: typeof value.operation_id === 'string' && value.operation_id.length > 0
      ? value.operation_id
      : null,
    source: {
      id: typeof source.id === 'string' && source.id.length > 0 ? source.id : null,
      runId: typeof source.run_id === 'string' && source.run_id.length > 0 ? source.run_id : null,
      rawEvidenceRef: typeof source.raw_evidence_ref === 'string' && source.raw_evidence_ref.length > 0
        ? source.raw_evidence_ref
        : null,
    },
    process: {
      exitCode: process.exit_code ?? null,
      durationMs: process.duration_ms ?? null,
      interrupted: process.interrupted ?? false,
    },
    streams,
  };
}

function streamDigest(streams) {
  const digest = createHash('sha256');
  for (const stream of streams) {
    digest.update(Buffer.from(`${stream.name}\0${stream.bytes.length}\0`, 'utf8'));
    digest.update(stream.bytes);
    digest.update(Buffer.from('\0', 'utf8'));
  }
  return `sha256:${digest.digest('hex')}`;
}

function splitLines(text) {
  if (text.length === 0) return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines;
}

function lineEvidence(line, category, includeText = true) {
  const value = {
    category,
    line: line.line,
    sha256: sha256(Buffer.from(line.text, 'utf8')),
    stream: line.stream,
  };
  if (includeText) value.text = line.text;
  else value.byte_count = Buffer.byteLength(line.text, 'utf8');
  return value;
}

function classifyFailureDetail(clean) {
  if (/^\s*(?:operator|expected|actual|diff|code):/i.test(clean)) return 'assertion';
  if (/^\s*(?:[A-Za-z]*Error:|at\s+|.*\([^()]+:\d+:\d+\)\s*$)/.test(clean)) return 'stack_trace';
  if (/^\s*(?:error|message|cause):/i.test(clean)) return 'failure_message';
  return 'failure_detail';
}

function parseTranscript(streams) {
  const lines = [];
  const failures = [];
  const fatalErrors = [];
  const timeouts = [];
  const warnings = [];
  const unclassified = [];
  const summaryValues = new Map();
  const summaryConflicts = [];
  const observed = { passed: 0, failed: 0, skipped: 0 };
  let malformedUtf8 = false;

  for (const stream of streams) {
    let text;
    try {
      text = utf8Decoder.decode(stream.bytes);
    } catch {
      malformedUtf8 = true;
      if (stream.bytes.length > 0) {
        const line = {
          stream: stream.name,
          line: 1,
          text: `[non-UTF-8 ${stream.bytes.length} bytes; ${sha256(stream.bytes)}]`,
          kind: 'unclassified_binary',
        };
        lines.push(line);
        unclassified.push(line);
      }
      continue;
    }

    let currentFailure = null;
    for (const [index, rawLine] of splitLines(text).entries()) {
      const line = { stream: stream.name, line: index + 1, text: rawLine };
      const clean = rawLine.replace(/\r$/, '').replace(ANSI_PATTERN, '');
      const marker = clean.match(/^\s*(not ok|ok)\b(?:\s+\d+)?(?:\s*-\s*)?(.*)$/);
      const summary = clean.match(/^\s*#\s*(tests|pass|fail|skipped)\s+(\d+)\s*$/);

      if (marker) {
        currentFailure = null;
        const directive = marker[2].match(/\s+#\s*(SKIP|TODO)\b.*$/i);
        const identity = marker[2].replace(/\s+#\s*(?:SKIP|TODO)\b.*$/i, '').trim() || '(unnamed test)';
        if (marker[1] === 'ok' && directive?.[1].toUpperCase() === 'SKIP') {
          line.kind = 'skipped_test';
          observed.skipped += 1;
        } else if (marker[1] === 'ok') {
          line.kind = 'successful_test';
          observed.passed += 1;
        } else if (directive?.[1].toUpperCase() === 'TODO') {
          line.kind = 'unclassified';
          unclassified.push(line);
        } else {
          line.kind = 'failed_test';
          observed.failed += 1;
          currentFailure = { identity, header: line, details: [] };
          failures.push(currentFailure);
        }
      } else if (summary) {
        currentFailure = null;
        line.kind = 'aggregate_source';
        const key = summary[1] === 'pass' ? 'passed'
          : summary[1] === 'fail' ? 'failed'
            : summary[1];
        const value = Number(summary[2]);
        if (summaryValues.has(key) && summaryValues.get(key) !== value) {
          summaryConflicts.push(key);
        }
        summaryValues.set(key, value);
      } else if (currentFailure && !/^\s*(?:TAP version \d+|1\.\.\d+|#\s*Subtest:.*)\s*$/.test(clean)) {
        line.kind = classifyFailureDetail(clean);
        currentFailure.details.push(line);
      } else if (/^\s*(?:TAP version \d+|1\.\.\d+|#\s*Subtest:.*|---|\.\.\.)\s*$/.test(clean)) {
        currentFailure = null;
        line.kind = 'structure';
      } else {
        const fatal = clean.match(/^\s*(?:#\s*)?(?:FATAL|RUNNER CRASH|UNCAUGHT):\s*(.+)$/);
        const timeout = clean.match(/^\s*(?:#\s*)?TIMEOUT:\s*(.+)$/);
        const warning = clean.match(/^\s*(?:#\s*)?(?:WARNING|WARN):\s*(.+)$/);
        if (fatal) {
          line.kind = 'fatal_error';
          fatalErrors.push(line);
        } else if (timeout) {
          line.kind = 'timeout';
          timeouts.push(line);
        } else if (warning) {
          line.kind = 'abnormal_warning';
          warnings.push(line);
        } else if (/^\s*#\s*(?:duration_ms\s+\d+(?:\.\d+)?|note:\s*.*)\s*$/.test(clean)) {
          line.kind = clean.includes('duration_ms') ? 'duration_source' : 'informational';
        } else if (/^\s*$/.test(clean)) {
          line.kind = 'blank';
        } else {
          line.kind = 'unclassified';
          unclassified.push(line);
        }
      }
      lines.push(line);
    }
  }

  const counts = {
    passed: summaryValues.get('passed') ?? observed.passed,
    failed: summaryValues.get('failed') ?? observed.failed,
    skipped: summaryValues.get('skipped') ?? observed.skipped,
    total: summaryValues.get('tests')
      ?? ((summaryValues.has('passed') || summaryValues.has('failed') || summaryValues.has('skipped'))
        ? (summaryValues.get('passed') ?? 0) + (summaryValues.get('failed') ?? 0) + (summaryValues.get('skipped') ?? 0)
        : observed.passed + observed.failed + observed.skipped),
  };
  const contradictions = [...summaryConflicts];
  for (const key of ['passed', 'failed', 'skipped']) {
    if (summaryValues.has(key) && summaryValues.get(key) !== observed[key]) contradictions.push(key);
  }
  if (summaryValues.has('tests') && summaryValues.get('tests') !== observed.passed + observed.failed + observed.skipped) {
    contradictions.push('total');
  }

  return {
    lines,
    failures,
    fatalErrors,
    timeouts,
    warnings,
    unclassified,
    counts,
    contradictions: [...new Set(contradictions)].sort(),
    malformedUtf8,
  };
}

function categoryCounts(lines) {
  const counts = {};
  for (const line of lines) counts[line.kind] = (counts[line.kind] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function addReason(reasons, reason) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function evidenceStatus(invocation, parsed, reasons) {
  const recognizedFailure = parsed.failures.length > 0
    || parsed.fatalErrors.length > 0
    || parsed.timeouts.length > 0
    || parsed.counts.failed > 0;
  const nonzero = invocation.process.exitCode != null && invocation.process.exitCode !== 0;

  if (parsed.unclassified.length > 0) addReason(reasons, 'UNCLASSIFIED_EVIDENCE');
  if (parsed.malformedUtf8) addReason(reasons, 'MALFORMED_UTF8');
  if (parsed.contradictions.length > 0) addReason(reasons, 'AGGREGATE_CONTRADICTION');
  if (invocation.process.interrupted) addReason(reasons, 'INTERRUPTED_OUTPUT');
  if (invocation.process.exitCode == null) addReason(reasons, 'EXIT_STATUS_MISSING');
  if (nonzero && !recognizedFailure) addReason(reasons, 'NONZERO_EXIT_WITHOUT_RECOGNIZED_FAILURE');
  if (!invocation.operationId) addReason(reasons, 'OPERATION_ID_MISSING');
  if (!invocation.source.id) addReason(reasons, 'SOURCE_IDENTITY_MISSING');
  if (!invocation.source.rawEvidenceRef) addReason(reasons, 'RAW_EVIDENCE_REFERENCE_MISSING');

  if (recognizedFailure || nonzero) return 'failed';
  if (reasons.some((reason) => !['RAW_EVIDENCE_REFERENCE_MISSING'].includes(reason))) return 'indeterminate';
  return 'passed';
}

function measurements(originalBytes, originalEvents, retainedLines, packetBytes) {
  return {
    original_bytes: originalBytes,
    original_event_count: originalEvents,
    reduced_bytes: packetBytes,
    retained_evidence_count: retainedLines,
    suppressed_evidence_count: originalEvents - retainedLines,
  };
}

function finalizePacket(packet, originalBytes, originalEvents, retainedLines) {
  let reducedBytes = 0;
  for (let iteration = 0; iteration < 12; iteration += 1) {
    packet.receipt.measurements = measurements(
      originalBytes,
      originalEvents,
      retainedLines,
      reducedBytes,
    );
    const next = Buffer.byteLength(`${canonicalJson(packet)}\n`, 'utf8');
    if (next === reducedBytes) return packet;
    reducedBytes = next;
  }
  throw new Error('reduced byte measurement did not converge');
}

function buildPacket({ invocation, parsed, configuration, baseReasons, mode }) {
  const includeWarnings = mode === 'full';
  const includeUnclassified = mode === 'full';
  const includeCriticalText = mode !== 'compact';
  const reasons = [...baseReasons];
  const payloadAffected = mode !== 'full';
  if (mode === 'references') addReason(reasons, 'PAYLOAD_LIMIT_OMITTED_NONCRITICAL_TEXT');
  if (mode === 'compact') addReason(reasons, 'PAYLOAD_LIMIT_CRITICAL_EVIDENCE_EXCEEDED');
  reasons.sort();

  const failurePackets = parsed.failures.map((failure) => ({
    identity: failure.identity,
    ...(includeCriticalText ? {
      header: lineEvidence(failure.header, 'failed_test'),
      details: failure.details.map((line) => lineEvidence(line, line.kind)),
    } : {}),
  }));
  const fatalPackets = includeCriticalText
    ? parsed.fatalErrors.map((line) => lineEvidence(line, 'fatal_error'))
    : [];
  const timeoutPackets = includeCriticalText
    ? parsed.timeouts.map((line) => lineEvidence(line, 'timeout'))
    : [];
  const warningPackets = parsed.warnings.map((line) => lineEvidence(line, 'abnormal_warning', includeWarnings));
  const unclassifiedPackets = parsed.unclassified.map((line) => lineEvidence(line, line.kind, includeUnclassified));

  const retainedKinds = new Set();
  if (includeCriticalText) {
    for (const failure of parsed.failures) {
      retainedKinds.add(failure.header);
      for (const detail of failure.details) retainedKinds.add(detail);
    }
    for (const line of [...parsed.fatalErrors, ...parsed.timeouts]) retainedKinds.add(line);
  }
  if (includeWarnings) for (const line of parsed.warnings) retainedKinds.add(line);
  if (includeUnclassified) for (const line of parsed.unclassified) retainedKinds.add(line);
  const retainedLines = parsed.lines.filter((line) => retainedKinds.has(line));
  const suppressedLines = parsed.lines.filter((line) => !retainedKinds.has(line));
  const retainedCategories = [
    'aggregate_counts',
    'process_status',
    'run_verdict',
    'stream_provenance',
    ...Object.keys(categoryCounts(retainedLines)),
  ].sort();

  const decisionEvidence = {
    counts: parsed.counts,
    disposition: reasons.length === 0 ? 'SUFFICIENT' : 'NEEDS_RAW_EVIDENCE',
    failures: failurePackets,
    fatal_errors: fatalPackets,
    process: {
      duration_ms: invocation.process.durationMs,
      exit_code: invocation.process.exitCode,
      interrupted: invocation.process.interrupted,
    },
    reason_codes: reasons,
    source: {
      id: invocation.source.id,
      run_id: invocation.source.runId,
    },
    status: evidenceStatus(invocation, parsed, []),
    timeouts: timeoutPackets,
    unclassified_evidence: unclassifiedPackets,
    warnings: warningPackets,
  };

  const originalBytes = invocation.streams.reduce((sum, stream) => sum + stream.bytes.length, 0);
  const inputHash = streamDigest(invocation.streams);
  const semanticHash = sha256(Buffer.from(canonicalJson(decisionEvidence), 'utf8'));
  const packet = {
    decision_evidence: decisionEvidence,
    operation_id: invocation.operationId,
    protocol_version: PACKET_PROTOCOL,
    receipt: {
      configuration: {
        identity: configuration.identity,
        max_output_bytes: configuration.maxOutputBytes,
        policy_revision: POLICY_REVISION,
      },
      input_hash: inputHash,
      measurements: {},
      payload_limit: {
        affected: payloadAffected,
        honored: true,
        requested_bytes: configuration.maxOutputBytes,
      },
      raw_evidence: {
        destroyed_by_reducer: false,
        escalation_available: Boolean(invocation.source.rawEvidenceRef),
        escalation_required: reasons.length > 0,
        reference: invocation.source.rawEvidenceRef,
        source_evidence_disposition: invocation.source.rawEvidenceRef
          ? 'CALLER_REFERENCE_SUPPLIED'
          : 'PRESERVATION_UNCONFIRMED',
        suppressed_from_model_context: suppressedLines.length > 0,
      },
      receipt_version: 1,
      reducer: {
        name: REDUCER_NAME,
        version: REDUCER_VERSION,
      },
      reduction_complete: reasons.length === 0,
      retained: {
        categories: retainedCategories,
        event_count: retainedLines.length,
      },
      semantic_payload_hash: semanticHash,
      source: {
        id: invocation.source.id,
        protocol_version: invocation.protocolVersion,
        run_id: invocation.source.runId,
        streams: invocation.streams.map((stream) => ({
          byte_count: stream.bytes.length,
          name: stream.name,
        })),
      },
      suppressed: {
        categories: categoryCounts(suppressedLines),
        event_count: suppressedLines.length,
      },
      unclassified_evidence_present: parsed.unclassified.length > 0,
    },
  };
  return finalizePacket(packet, originalBytes, parsed.lines.length, retainedLines.length);
}

function normalizeConfiguration(options = {}) {
  const maxOutputBytes = options.maxOutputBytes ?? null;
  if (maxOutputBytes != null && (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1)) {
    throw new InputError('maxOutputBytes must be a positive integer or null');
  }
  const semantic = {
    max_output_bytes: maxOutputBytes,
    policy_revision: POLICY_REVISION,
    reducer_version: REDUCER_VERSION,
  };
  return {
    maxOutputBytes,
    identity: sha256(Buffer.from(canonicalJson(semantic), 'utf8')),
  };
}

export function reduceTestRun(input, options = {}) {
  const invocation = normalizeInvocation(input);
  const configuration = normalizeConfiguration(options);
  const parsed = parseTranscript(invocation.streams);
  const reasons = [];
  evidenceStatus(invocation, parsed, reasons);
  reasons.sort();

  const full = buildPacket({ invocation, parsed, configuration, baseReasons: reasons, mode: 'full' });
  if (configuration.maxOutputBytes == null || serializePacket(full).length <= configuration.maxOutputBytes) {
    return full;
  }

  const references = buildPacket({ invocation, parsed, configuration, baseReasons: reasons, mode: 'references' });
  if (serializePacket(references).length <= configuration.maxOutputBytes) return references;

  const compact = buildPacket({ invocation, parsed, configuration, baseReasons: reasons, mode: 'compact' });
  if (serializePacket(compact).length <= configuration.maxOutputBytes) return compact;

  throw new PayloadCeilingError({
    disposition: 'NEEDS_RAW_EVIDENCE',
    input_hash: streamDigest(invocation.streams),
    max_output_bytes: configuration.maxOutputBytes,
    minimum_safe_packet_bytes: serializePacket(compact).length,
    raw_evidence_ref: invocation.source.rawEvidenceRef,
    reason: 'PAYLOAD_CEILING_TOO_SMALL',
  });
}

export function serializePacket(packet) {
  return Buffer.from(`${canonicalJson(packet)}\n`, 'utf8');
}

export function valueReceiptForPacket(packet, { mechanismRevision = null } = {}) {
  if (mechanismRevision != null && (typeof mechanismRevision !== 'string' || mechanismRevision.length === 0)) {
    throw new InputError('mechanismRevision must be a nonempty string or null');
  }
  const measurements = packet.receipt.measurements;
  return buildReductionValueReceipt({
    ambiguousEvents: packet.decision_evidence.unclassified_evidence.length,
    configurationIdentity: packet.receipt.configuration.identity,
    escalationRequired: packet.receipt.raw_evidence.escalation_required,
    inputHash: packet.receipt.input_hash,
    mechanismRevision,
    mechanismVersion: REDUCER_VERSION,
    operationId: packet.operation_id,
    originalBytes: measurements.original_bytes,
    originalEvents: measurements.original_event_count,
    payloadCeilingBytes: packet.receipt.configuration.max_output_bytes,
    policyRevision: packet.receipt.configuration.policy_revision,
    rawEvidenceRef: packet.receipt.raw_evidence.reference,
    reducedBytes: measurements.reduced_bytes,
    retainedEvents: measurements.retained_evidence_count,
    runId: packet.receipt.source.run_id,
    semanticPayloadHash: packet.receipt.semantic_payload_hash,
  });
}

export function reduceWithValueReceipt(input, options = {}) {
  const packet = reduceTestRun(input, options);
  return {
    packet,
    valueReceipt: valueReceiptForPacket(packet, {
      mechanismRevision: options.mechanismRevision ?? null,
    }),
  };
}
