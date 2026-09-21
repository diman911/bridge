import { describe, expect, it } from 'vitest';
import { decodeAttachmentMetaV1 } from './attachment.js';

const meta = {
  protocolVersion: 1,
  project_id: 'project-1',
  integration_instance_id: 'tracker-1',
  issueId: 'APP-42',
  filename: 'capture.har',
  contentType: 'application/x-http-archive',
};

describe('attachment meta v1', () => {
  it('maps wire routing fields to the internal model', () => {
    expect(decodeAttachmentMetaV1(meta)).toEqual({
      ok: true,
      value: {
        protocolVersion: 1,
        projectId: 'project-1',
        integrationInstanceId: 'tracker-1',
        issueId: 'APP-42',
        filename: 'capture.har',
        contentType: 'application/x-http-archive',
      },
    });
  });

  it('rejects path-like filenames and unsupported versions', () => {
    expect(decodeAttachmentMetaV1({ ...meta, filename: '../capture.har' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_attachment_meta' },
    });
    expect(decodeAttachmentMetaV1({ ...meta, protocolVersion: 2 })).toMatchObject({
      ok: false,
      error: { code: 'unsupported_protocol_version' },
    });
  });
});
