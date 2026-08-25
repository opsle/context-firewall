export const VALUE_RECEIPT_SCHEMA = 'opsle.value-receipt.v1';
export const VALUE_MECHANISM_ID = 'opsle.context-firewall';
export const VALUE_MECHANISM_NAME = 'Context Firewall';

const NO_CAUSAL_CLAIM = 'No token, cost, latency, correctness, or causal savings claim is made.';

function measurement({
  id,
  baseline,
  result,
  delta,
  unit,
  direction,
  measurementClass,
  evidenceRefs,
  sourceVerification,
  operatorDisplay,
  safeToAggregate,
  limitations = [],
}) {
  return {
    aggregation: {
      method: safeToAggregate ? 'SUM' : null,
      safe: safeToAggregate,
    },
    baseline,
    class: measurementClass,
    delta,
    derivation: null,
    direction,
    evidence_refs: evidenceRefs,
    id,
    limitations,
    operator_display: operatorDisplay,
    result,
    source_verification: sourceVerification,
    unit,
  };
}

export function buildReductionValueReceipt({
  ambiguousEvents,
  configurationIdentity,
  escalationRequired,
  inputHash,
  mechanismRevision,
  mechanismVersion,
  operationId,
  originalBytes,
  originalEvents,
  payloadCeilingBytes,
  policyRevision,
  rawEvidenceRef,
  reducedBytes,
  retainedEvents,
  runId,
  semanticPayloadHash,
}) {
  const bytesInitiallyAvoided = originalBytes - reducedBytes;
  const reductionRatio = originalBytes === 0
    ? null
    : `${bytesInitiallyAvoided}/${originalBytes}`;
  const suppressedEvents = originalEvents - retainedEvents;
  const evidence = [
    {
      id: 'canonical_packet',
      kind: 'JSON_POINTER',
      locator: '/',
      trust: 'VERIFIED',
    },
    {
      id: 'configuration',
      kind: 'CONTENT_HASH',
      locator: configurationIdentity,
      trust: 'VERIFIED',
    },
    {
      id: 'input_bytes',
      kind: 'CONTENT_HASH',
      locator: inputHash,
      trust: 'VERIFIED',
    },
    {
      id: 'semantic_payload',
      kind: 'CONTENT_HASH',
      locator: semanticPayloadHash,
      trust: 'VERIFIED',
    },
  ];
  if (rawEvidenceRef) {
    evidence.push({
      id: 'raw_locator',
      kind: 'RUN_ARTIFACT',
      locator: rawEvidenceRef,
      trust: 'CALLER_SUPPLIED',
    });
  }

  const ratioLimitations = [
    'Computed as (raw bytes - initially model-visible bytes) / raw bytes.',
    'Negative values indicate canonical packet expansion.',
    'Ratios are not directly summable; cumulative ratios must be recomputed from byte totals.',
  ];
  if (originalBytes === 0) {
    ratioLimitations.push('Unavailable because the raw-byte baseline is zero.');
  }

  return {
    evidence,
    limitations: [
      NO_CAUSAL_CLAIM,
      'Evidence-event counts cover source transcript events, not derived packet fields.',
      mechanismRevision
        ? 'Mechanism source revision is caller supplied and is not inspected by the deterministic reducer.'
        : 'Mechanism source revision was not supplied and is recorded as null.',
      rawEvidenceRef
        ? 'The raw evidence locator is caller supplied; external existence, immutability, and contents are not verified.'
        : 'No raw evidence locator was supplied.',
    ],
    measurements: [
      measurement({
        id: 'raw_bytes',
        baseline: null,
        result: originalBytes,
        delta: null,
        unit: 'byte',
        direction: 'NEUTRAL',
        measurementClass: 'EXACT',
        evidenceRefs: ['input_bytes'],
        sourceVerification: 'VERIFIED',
        operatorDisplay: false,
        safeToAggregate: true,
      }),
      measurement({
        id: 'initial_model_visible_bytes',
        baseline: originalBytes,
        result: reducedBytes,
        delta: reducedBytes - originalBytes,
        unit: 'byte',
        direction: 'LOWER_IS_VALUE',
        measurementClass: 'EXACT',
        evidenceRefs: ['canonical_packet', 'input_bytes'],
        sourceVerification: 'VERIFIED',
        operatorDisplay: true,
        safeToAggregate: true,
        limitations: ['Result is the canonical evidence packet written to model-visible stdout.'],
      }),
      measurement({
        id: 'bytes_initially_avoided',
        baseline: reducedBytes,
        result: originalBytes,
        delta: bytesInitiallyAvoided,
        unit: 'byte',
        direction: 'HIGHER_IS_VALUE',
        measurementClass: 'EXACT',
        evidenceRefs: ['canonical_packet', 'input_bytes'],
        sourceVerification: 'VERIFIED',
        operatorDisplay: true,
        safeToAggregate: true,
        limitations: ['Signed delta is raw bytes minus initially model-visible bytes; a negative delta indicates expansion.'],
      }),
      measurement({
        id: 'initial_reduction_ratio',
        baseline: null,
        result: reductionRatio,
        delta: null,
        unit: 'ratio',
        direction: 'HIGHER_IS_VALUE',
        measurementClass: 'EXACT',
        evidenceRefs: ['canonical_packet', 'input_bytes'],
        sourceVerification: 'VERIFIED',
        operatorDisplay: true,
        safeToAggregate: false,
        limitations: ratioLimitations,
      }),
      measurement({
        id: 'original_evidence_events',
        baseline: null,
        result: originalEvents,
        delta: null,
        unit: 'event',
        direction: 'NEUTRAL',
        measurementClass: 'EXACT',
        evidenceRefs: ['semantic_payload'],
        sourceVerification: 'VERIFIED',
        operatorDisplay: false,
        safeToAggregate: true,
      }),
      measurement({
        id: 'retained_evidence_events',
        baseline: null,
        result: retainedEvents,
        delta: null,
        unit: 'event',
        direction: 'NEUTRAL',
        measurementClass: 'EXACT',
        evidenceRefs: ['semantic_payload'],
        sourceVerification: 'VERIFIED',
        operatorDisplay: false,
        safeToAggregate: true,
      }),
      measurement({
        id: 'suppressed_evidence_events',
        baseline: null,
        result: suppressedEvents,
        delta: null,
        unit: 'event',
        direction: 'NEUTRAL',
        measurementClass: 'EXACT',
        evidenceRefs: ['semantic_payload'],
        sourceVerification: 'VERIFIED',
        operatorDisplay: false,
        safeToAggregate: true,
      }),
      measurement({
        id: 'ambiguous_evidence_events',
        baseline: null,
        result: ambiguousEvents,
        delta: null,
        unit: 'event',
        direction: 'PROTECTION_SIGNAL',
        measurementClass: 'EXACT',
        evidenceRefs: ['semantic_payload'],
        sourceVerification: 'VERIFIED',
        operatorDisplay: false,
        safeToAggregate: true,
        limitations: ['Counts unclassified source events, including synthetic markers for malformed UTF-8.'],
      }),
      measurement({
        id: 'payload_ceiling_bytes',
        baseline: null,
        result: payloadCeilingBytes,
        delta: null,
        unit: 'byte',
        direction: 'NOT_APPLICABLE',
        measurementClass: 'EXACT',
        evidenceRefs: ['configuration'],
        sourceVerification: 'VERIFIED',
        operatorDisplay: false,
        safeToAggregate: false,
        limitations: payloadCeilingBytes == null ? ['No payload ceiling was configured.'] : [],
      }),
      measurement({
        id: 'escalation_required',
        baseline: null,
        result: escalationRequired,
        delta: null,
        unit: 'boolean',
        direction: 'PROTECTION_SIGNAL',
        measurementClass: 'OBSERVED',
        evidenceRefs: ['canonical_packet'],
        sourceVerification: 'OBSERVED',
        operatorDisplay: true,
        safeToAggregate: false,
      }),
      measurement({
        id: 'raw_locator_available',
        baseline: null,
        result: Boolean(rawEvidenceRef),
        delta: null,
        unit: 'boolean',
        direction: 'PROTECTION_SIGNAL',
        measurementClass: 'OBSERVED',
        evidenceRefs: [rawEvidenceRef ? 'raw_locator' : 'canonical_packet'],
        sourceVerification: rawEvidenceRef ? 'CALLER_SUPPLIED' : 'OBSERVED',
        operatorDisplay: false,
        safeToAggregate: false,
        limitations: ['Availability means a caller supplied a locator; the external artifact is not verified by the reducer.'],
      }),
    ],
    mechanism: {
      id: VALUE_MECHANISM_ID,
      name: VALUE_MECHANISM_NAME,
      revision: mechanismRevision,
      version: mechanismVersion,
    },
    operation: {
      configuration_id: configurationIdentity,
      id: operationId,
      name: 'test-output-reduction',
      policy_id: policyRevision,
    },
    run: {
      id: runId,
    },
    schema: VALUE_RECEIPT_SCHEMA,
  };
}

function measurementById(receipt, id) {
  return receipt.measurements.find((item) => item.id === id);
}

function groupedInteger(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatContextFirewallIndicator(receipt) {
  const rawBytes = measurementById(receipt, 'raw_bytes').result;
  const visibleBytes = measurementById(receipt, 'initial_model_visible_bytes').result;
  const avoidedBytes = measurementById(receipt, 'bytes_initially_avoided').delta;
  const reductionRatio = measurementById(receipt, 'initial_reduction_ratio').result;
  const escalationRequired = measurementById(receipt, 'escalation_required').result;
  let visibleValue;
  if (avoidedBytes >= 0) {
    const percentage = reductionRatio == null ? '' : ` (${(avoidedBytes / rawBytes * 100).toFixed(2)}%)`;
    visibleValue = `${groupedInteger(avoidedBytes)} B initially avoided${percentage}`;
  } else {
    visibleValue = `${groupedInteger(-avoidedBytes)} B expansion`;
  }
  return `[Context Firewall] ${groupedInteger(rawBytes)} B -> ${groupedInteger(visibleBytes)} B | ${visibleValue} | escalation: ${escalationRequired ? 'yes' : 'no'}`;
}
