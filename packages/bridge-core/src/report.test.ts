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
    const mapped = mapReportToIssue(
      {
        protocolVersion: 1,
        projectId: 'p',
        trackerInstanceId: 't',
        intent: { action: 'create_issue' },
        title: 'Checkout fails',
        description: 'User summary',
        report,
        options: { includeHar: true, includeScreenshots: true },
        idempotencyKey: 'key',
      },
      decoded.value,
    );
    expect(mapped.renderedDescription).toContain('Fairlead technical context');
    expect(mapped.artifacts.map((artifact) => artifact.filename)).toEqual([
      'network.har',
      'screenshot-capture-1.png',
    ]);
  });

  it('rejects a report schema outside the current/previous support window', () => {
    expect(decodeReport({ ...report, schema_version: 2 })).toMatchObject({
      ok: false,
      error: { code: 'unsupported_report_schema_version' },
    });
  });
});
