import type { IntegrationError } from './types.js';

export const MAX_SUBJECT_LENGTH = 32_768;
export const MAX_DESCRIPTION_LENGTH = 32_768;
export const MAX_TECHNICAL_SECTION_LENGTH = 32_768;

export interface DeprecationNotice {
  successorVersion: number;
  endOfSupportAt: string;
  message?: string;
}
export const DEPRECATED_PROTOCOL_VERSIONS: ReadonlyMap<number, DeprecationNotice> = new Map();
export interface ResponseMetadata {
  deprecation?: DeprecationNotice;
}

interface InternalCommandBase {
  protocolVersion: 1;
  projectId: string;
  trackerInstanceId: string;
  idempotencyKey: string;
}
export interface InternalCreateIssueCommand extends InternalCommandBase {
  type: 'create_issue';
  subject: string;
  description: string;
  technicalSection?: string;
}
export interface InternalUpdateIssueCommand extends InternalCommandBase {
  type: 'update_issue';
  issueId: string;
  subject?: string;
  description?: string;
  technicalSection?: string;
  onConflict?: 'append' | 'replace';
}
export type InternalIntegrationCommand = InternalCreateIssueCommand | InternalUpdateIssueCommand;
export type DecodeResult =
  { ok: true; value: InternalIntegrationCommand } | { ok: false; error: IntegrationError };
export type EnvelopeDecoder = (value: unknown) => DecodeResult;

function fail(code: string, message: string): DecodeResult {
  return { ok: false, error: { code, message } };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function has(value: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}
function requiredString(value: Record<string, unknown>, field: string): string | null {
  const candidate = value[field];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}
function optionalText(
  value: Record<string, unknown>,
  field: string,
  maximum: number,
): string | undefined | null {
  if (!has(value, field)) return undefined;
  const candidate = value[field];
  return typeof candidate === 'string' && candidate.length <= maximum ? candidate : null;
}
function invalidText(field: string, maximum: number): DecodeResult {
  return fail('invalid_command', `${field} must be a string of at most ${maximum} characters`);
}

export function decodeEnvelopeV1(value: unknown): DecodeResult {
  if (!isRecord(value)) return fail('invalid_envelope', 'envelope must be an object');
  if (value.protocolVersion !== 1)
    return fail('unsupported_protocol_version', 'envelope protocolVersion 1 is required');
  const projectId = requiredString(value, 'project_id');
  const trackerInstanceId = requiredString(value, 'tracker_instance_id');
  const idempotencyKey = requiredString(value, 'idempotencyKey');
  if (!projectId || !trackerInstanceId || !idempotencyKey)
    return fail(
      'invalid_envelope',
      'project_id, tracker_instance_id, and idempotencyKey are required',
    );
  if (value.type !== 'create_issue' && value.type !== 'update_issue')
    return fail('invalid_envelope', 'type must be create_issue or update_issue');

  const technicalSection = optionalText(value, 'technicalSection', MAX_TECHNICAL_SECTION_LENGTH);
  if (technicalSection === null)
    return invalidText('technicalSection', MAX_TECHNICAL_SECTION_LENGTH);

  if (value.type === 'create_issue') {
    if (has(value, 'issueId') || has(value, 'onConflict'))
      return fail('invalid_command', 'issueId and onConflict are not valid for create_issue');
    const subject = requiredString(value, 'subject');
    if (!subject || subject.length > MAX_SUBJECT_LENGTH)
      return fail(
        'invalid_command',
        `subject must be a non-empty string of at most ${MAX_SUBJECT_LENGTH} characters`,
      );
    const description = optionalText(value, 'description', MAX_DESCRIPTION_LENGTH);
    if (description === undefined || description === null)
      return invalidText('description', MAX_DESCRIPTION_LENGTH);
    return {
      ok: true,
      value: {
        protocolVersion: 1,
        projectId,
        trackerInstanceId,
        type: 'create_issue',
        subject,
        description,
        ...(technicalSection === undefined ? {} : { technicalSection }),
        idempotencyKey,
      },
    };
  }

  const issueId = requiredString(value, 'issueId');
  if (!issueId) return fail('invalid_command', 'issueId is required for update_issue');
  const subject = optionalText(value, 'subject', MAX_SUBJECT_LENGTH);
  if (subject === null || subject === '')
    return fail(
      'invalid_command',
      `subject must be a non-empty string of at most ${MAX_SUBJECT_LENGTH} characters`,
    );
  const description = optionalText(value, 'description', MAX_DESCRIPTION_LENGTH);
  if (description === null) return invalidText('description', MAX_DESCRIPTION_LENGTH);
  const onConflict = value.onConflict;
  if (has(value, 'onConflict') && onConflict !== 'append' && onConflict !== 'replace')
    return fail('invalid_command', 'onConflict must be append or replace');
  if (onConflict === 'replace' && description === undefined)
    return fail('invalid_command', 'description is required when onConflict is replace');
  if (subject === undefined && description === undefined && technicalSection === undefined)
    return fail('invalid_command', 'update_issue must contain at least one mutation');
  const validOnConflict = onConflict as 'append' | 'replace' | undefined;
  return {
    ok: true,
    value: {
      protocolVersion: 1,
      projectId,
      trackerInstanceId,
      type: 'update_issue',
      issueId,
      ...(subject === undefined ? {} : { subject }),
      ...(description === undefined ? {} : { description }),
      ...(technicalSection === undefined ? {} : { technicalSection }),
      ...(validOnConflict === undefined ? {} : { onConflict: validOnConflict }),
      idempotencyKey,
    },
  };
}

export const ENVELOPE_DECODERS: ReadonlyMap<number, EnvelopeDecoder> = new Map([
  [1, decodeEnvelopeV1],
]);
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
