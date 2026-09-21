import type { IntegrationError } from './types.js';

export const MAX_SUBJECT_LENGTH = 32_768;
export const MAX_DESCRIPTION_LENGTH = 32_768;
/**
 * Maximum encoded JSON request size for commands and reads. This is a
 * transport safety limit, not the retired report-envelope limit.
 */
export const MAX_JSON_REQUEST_BYTES = 256 * 1024;

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
}
export interface InternalCreateIssueCommand extends InternalCommandBase {
  type: 'create_issue';
  subject: string;
  description: string;
}
export interface InternalUpdateIssueCommand extends InternalCommandBase {
  type: 'update_issue';
  issueId: string;
  subject?: string;
  description?: string;
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
  if (!projectId || !trackerInstanceId)
    return fail('invalid_envelope', 'project_id and tracker_instance_id are required');
  if (value.type !== 'create_issue' && value.type !== 'update_issue')
    return fail('invalid_envelope', 'type must be create_issue or update_issue');

  if (value.type === 'create_issue') {
    if (has(value, 'issueId'))
      return fail('invalid_command', 'issueId is not valid for create_issue');
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
  if (subject === undefined && description === undefined)
    return fail('invalid_command', 'update_issue must contain at least one mutation');
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
