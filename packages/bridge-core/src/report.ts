import type { IntegrationError } from './types.js';

/**
 * Bridge owns this deliberately small JSON-compatible view of a sanitized
 * report. The producer may add fields, but the fields below are the only ones
 * Bridge reads or renders. `schema_version` is the report-contract version,
 * not the extension build version in `meta.version`.
 */
export const CURRENT_REPORT_SCHEMA_VERSION = 1;
export const SUPPORTED_REPORT_SCHEMA_VERSIONS: ReadonlySet<number> = new Set([1, 0]);

export interface BridgeReport {
  schemaVersion: number;
  meta: { url: string; startedAt: string; stoppedAt: string; title: string | null };
  summary: { errors: number; networkRequests: number; userActions: number };
  httpRequests: Record<string, unknown>[];
  screenshots: { id: string; dataUrl: string }[];
}

export type ReportDecodeResult =
  { ok: true; value: BridgeReport } | { ok: false; error: IntegrationError };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function error(code: string, message: string): ReportDecodeResult {
  return { ok: false, error: { code, message } };
}

/** Decodes only the stable report subset; unknown report fields are ignored. */
export function decodeReport(value: unknown): ReportDecodeResult {
  if (!record(value)) return error('invalid_report', 'report must be an object');
  const version = value.schema_version;
  if (typeof version !== 'number' || !Number.isInteger(version))
    return error('invalid_report', 'report schema_version is required');
  if (!SUPPORTED_REPORT_SCHEMA_VERSIONS.has(version))
    return error(
      'unsupported_report_schema_version',
      `report schema_version ${version} is not supported`,
    );
  if (!record(value.meta) || !record(value.summary))
    return error('invalid_report', 'report meta and summary are required');
  const meta = value.meta;
  const summary = value.summary;
  if (
    typeof meta.url !== 'string' ||
    typeof meta.started_at !== 'string' ||
    typeof meta.stopped_at !== 'string' ||
    (meta.title !== null && typeof meta.title !== 'string') ||
    typeof summary.errors !== 'number' ||
    typeof summary.network_requests !== 'number' ||
    typeof summary.user_actions !== 'number' ||
    !Array.isArray(value.http_requests) ||
    !Array.isArray(value.attachments)
  )
    return error('invalid_report', 'report does not contain the required Bridge report subset');
  const screenshots: { id: string; dataUrl: string }[] = [];
  for (const attachment of value.attachments) {
    if (
      !record(attachment) ||
      typeof attachment.id !== 'string' ||
      typeof attachment.dataUrl !== 'string'
    )
      return error('invalid_report', 'report attachments must contain id and dataUrl');
    screenshots.push({ id: attachment.id, dataUrl: attachment.dataUrl });
  }
  if (!value.http_requests.every(record))
    return error('invalid_report', 'http_requests must contain objects');
  return {
    ok: true,
    value: {
      schemaVersion: version,
      meta: {
        url: meta.url,
        startedAt: meta.started_at,
        stoppedAt: meta.stopped_at,
        title: meta.title as string | null,
      },
      summary: {
        errors: summary.errors,
        networkRequests: summary.network_requests,
        userActions: summary.user_actions,
      },
      httpRequests: value.http_requests,
      screenshots,
    },
  };
}
