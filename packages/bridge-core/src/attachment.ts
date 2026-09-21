import type { IntegrationError } from './types.js';

export const MAX_ATTACHMENT_META_BYTES = 16 * 1024;
export { MAX_ATTACHMENT_BYTES } from './attachment-v1.js';

export interface AttachmentMeta {
  protocolVersion: 1;
  projectId: string;
  integrationInstanceId: string;
  issueId: string;
  filename: string;
  contentType: string;
}

export type AttachmentMetaDecodeResult =
  { ok: true; value: AttachmentMeta } | { ok: false; error: IntegrationError };

function required(value: Record<string, unknown>, field: string): string | null {
  const candidate = value[field];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

export function decodeAttachmentMetaV1(value: unknown): AttachmentMetaDecodeResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return {
      ok: false,
      error: { code: 'invalid_attachment_meta', message: 'meta must be an object' },
    };
  const input = value as Record<string, unknown>;
  if (input.protocolVersion !== 1)
    return {
      ok: false,
      error: {
        code: 'unsupported_protocol_version',
        message: 'meta protocolVersion 1 is required',
      },
    };
  const projectId = required(input, 'project_id');
  const integrationInstanceId = required(input, 'integration_instance_id');
  const issueId = required(input, 'issueId');
  const filename = required(input, 'filename');
  const contentType = required(input, 'contentType');
  if (!projectId || !integrationInstanceId || !issueId || !filename || !contentType)
    return {
      ok: false,
      error: {
        code: 'invalid_attachment_meta',
        message: 'project_id, integration_instance_id, issueId, filename, and contentType are required',
      },
    };
  if (filename.includes('/') || filename.includes('\\') || filename === '.' || filename === '..')
    return {
      ok: false,
      error: { code: 'invalid_attachment_meta', message: 'filename must be a plain file name' },
    };
  return {
    ok: true,
    value: {
      protocolVersion: 1,
      projectId,
      integrationInstanceId,
      issueId,
      filename,
      contentType,
    },
  };
}

export interface ConnectorAttachment {
  protocolVersion: number;
  issueId: string;
  filename: string;
  contentType: string;
  data: ReadableStream<Uint8Array>;
  /** Shared state set by the bounded multipart stream before it errors. */
  limitState: { exceeded: boolean; actualBytes: number };
}
