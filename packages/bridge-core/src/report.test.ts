import { describe, expect, it } from 'vitest';
import { decodeReport } from './report.js';
import { mapReportToIssue } from './report-mapping.js';

const report = {
  schema_version: 1,
  meta: {
    url: 'https://app.example.test/checkout',
    started_at: '2026-09-21T12:00:00Z',
    stopped_at: '2026-09-21T12:01:00Z',
    title: 'Checkout',
  },
  summary: { errors: 2, network_requests: 4, user_actions: 3 },
  http_requests: [{ request: { method: 'POST' } }],
  attachments: [{ id: 'capture-1', dataUrl: 'data:image/png;base64,aGVsbG8=' }],
};

describe('report decoder and issue mapping', () => {
  it('supports the current report schema and materializes selected evidence', () => {
    const decoded = decodeReport(report);
    expect(decoded).toMatchObject({ ok: true });
    if (!decoded.ok) return;
    const mapped = mapReportToIssue({
      protocolVersion: 1,
      projectId: 'p',
      trackerInstanceId: 't',
      intent: { action: 'create_issue' },
      title: 'Checkout fails',
      description: 'User summary',
      report: decoded.value,
      options: { includeHar: true, includeScreenshots: true },
      idempotencyKey: 'key',
    });
    expect(mapped.technicalContext).toMatchObject({ url: report.meta.url, errors: 2 });
    expect(mapped.artifacts.map((artifact) => artifact.filename)).toEqual([
      'network.har',
      'screenshot-1-capture-1.png',
    ]);
  });

  it('labels screenshots by their real type, sanitizes ids, and returns every artifact', () => {
    const decoded = decodeReport({
      ...report,
      attachments: [
        { id: '../../x', dataUrl: 'data:image/jpeg;charset=utf-8;base64,aGVsbG8=' },
        { id: 'b', dataUrl: 'data:text/html;base64,aGVsbG8=' },
      ],
    });
    if (!decoded.ok) throw new Error('decode failed');
    const mapped = mapReportToIssue({
      protocolVersion: 1,
      projectId: 'p',
      trackerInstanceId: 't',
      intent: { action: 'create_issue' },
      title: 't',
      description: '',
      report: decoded.value,
      options: { includeHar: true, includeScreenshots: true },
      idempotencyKey: 'key',
    });
    expect(mapped.artifacts.map((a) => [a.filename, a.contentType])).toEqual([
      ['network.har', 'application/x-http-archive'],
      ['screenshot-1-______x.jpg', 'image/jpeg'],
    ]);
  });

  it('rejects a report schema outside the current/previous support window', () => {
    expect(decodeReport({ ...report, schema_version: 2 })).toMatchObject({
      ok: false,
      error: { code: 'unsupported_report_schema_version' },
    });
  });
});
