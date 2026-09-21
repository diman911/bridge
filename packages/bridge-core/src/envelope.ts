import type { EnvelopeIntent, EvidenceOptions } from './envelope-v1.js';
import type { IntegrationError } from './types.js';
import { decodeReport, type BridgeReport } from './report.js';

/** Conservative temporary ceiling; B7 replaces this with the measured Worker limit. */
/** Product ceiling. Cloudflare accepts at least 100 MB, but JSON buffering must stay well below the 128 MB Worker memory limit. */
export const MAX_ENVELOPE_BYTES = 10 * 1024 * 1024;
export const MAX_TITLE_LENGTH = 32_768;
export const MAX_DESCRIPTION_LENGTH = 32_768;

/** Announced while a supported version is inside its end-of-support window. */
export interface DeprecationNotice {
  protocolVersion: number;
  /** ISO-8601 date at which this version stops being accepted. */
  endOfSupport: string;
  message: string;
}

/** Additive metadata returned beside a command or read result. */
export interface ResponseMetadata {
  deprecation?: DeprecationNotice;
}

/** Connector-facing command, independent of the extension's wire casing. */
export interface InternalIntegrationCommand {
  protocolVersion: number;
  projectId: string;
  trackerInstanceId: string;
  intent: EnvelopeIntent;
  title: string;
  description: string;
  report: BridgeReport;
  options: EvidenceOptions;
  idempotencyKey: string;
}

export type DecodeResult =
  { ok: true; value: InternalIntegrationCommand } | { ok: false; error: IntegrationError };
export type EnvelopeDecoder = (value: unknown) => DecodeResult;

function fail(code: string, message: string): DecodeResult {
  return { ok: false, error: { code, message } };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function requiredString(value: Record<string, unknown>, field: string): string | null {
  const candidate = value[field];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}
function decodeIntent(value: unknown): EnvelopeIntent | null {
  if (!isRecord(value) || typeof value.action !== 'string') return null;
  if (value.action === 'create_issue') return { action: 'create_issue' };
  if (value.action !== 'update_issue' && value.action !== 'add_comment') return null;
  if (
    !isRecord(value.target) ||
    value.target.kind !== 'issue' ||
    typeof value.target.id !== 'string'
  )
    return null;
  if (!value.target.id) return null;
  return { action: value.action, target: { kind: 'issue', id: value.target.id } };
}
function decodeOptions(value: unknown): EvidenceOptions | null {
  if (!isRecord(value)) return null;
  if (typeof value.includeHar !== 'boolean' || typeof value.includeScreenshots !== 'boolean')
    return null;
  return { includeHar: value.includeHar, includeScreenshots: value.includeScreenshots };
}
function serializedEnvelopeBytes(value: Record<string, unknown>): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return null;
  }
}

/** Decodes the v1 wire shape to the single connector-facing internal model. */
export function decodeEnvelopeV1(value: unknown): DecodeResult {
  if (!isRecord(value)) return fail('invalid_envelope', 'envelope must be an object');
  const bytes = serializedEnvelopeBytes(value);
  if (bytes === null) return fail('invalid_envelope', 'envelope must be JSON-serializable');
  if (bytes > MAX_ENVELOPE_BYTES)
    return fail('envelope_too_large', `envelope must not exceed ${MAX_ENVELOPE_BYTES} bytes`);
  if (value.protocolVersion !== 1)
    return fail(
      'unsupported_protocol_version',
      'envelope protocolVersion 1 is required for this route',
    );
  const projectId = requiredString(value, 'project_id');
  const trackerInstanceId = requiredString(value, 'tracker_instance_id');
  const idempotencyKey = requiredString(value, 'idempotencyKey');
  if (!projectId || !trackerInstanceId || !idempotencyKey)
    return fail(
      'invalid_envelope',
      'project_id, tracker_instance_id, and idempotencyKey are required',
    );
  if (typeof value.title !== 'string' || value.title.length > MAX_TITLE_LENGTH)
    return fail(
      'invalid_title',
      `title must be a string of at most ${MAX_TITLE_LENGTH} characters`,
    );
  if (typeof value.description !== 'string' || value.description.length > MAX_DESCRIPTION_LENGTH)
    return fail(
      'invalid_description',
      `description must be a string of at most ${MAX_DESCRIPTION_LENGTH} characters`,
    );
  const intent = decodeIntent(value.intent);
  if (!intent) return fail('invalid_intent', 'intent must be a supported action and target');
  const report = decodeReport(value.report);
  if (!report.ok) return { ok: false, error: report.error };
  const options = decodeOptions(value.options);
  if (!options)
    return fail('invalid_options', 'options must select HAR and screenshots explicitly');
  return {
    ok: true,
    value: {
      protocolVersion: 1,
      projectId,
      trackerInstanceId,
      intent,
      title: value.title,
      description: value.description,
      report: report.value,
      options,
      idempotencyKey,
    },
  };
}

/** Registry is the sole version-to-decoder dispatch point for all routes. */
export const ENVELOPE_DECODERS: ReadonlyMap<number, EnvelopeDecoder> = new Map([
  [1, decodeEnvelopeV1],
]);
/** Versions whose frozen wire fixtures the current Bridge must still accept. */
export const SUPPORTED_PROTOCOL_VERSIONS: ReadonlySet<number> = new Set(ENVELOPE_DECODERS.keys());

export function decodeEnvelope(value: unknown): DecodeResult {
  if (!isRecord(value) || typeof value.protocolVersion !== 'number')
    return fail('invalid_envelope', 'envelope protocolVersion is required');
  const decoder = ENVELOPE_DECODERS.get(value.protocolVersion);
  return decoder
    ? decoder(value)
    : fail(
        'unsupported_protocol_version',
        `envelope protocolVersion ${value.protocolVersion} is not supported`,
      );
}
