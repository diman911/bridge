import { describe, expect, it } from 'vitest';
import {
  ENVELOPE_DECODERS,
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  SUPPORTED_PROTOCOL_VERSIONS,
  decodeEnvelope,
} from './envelope.js';

import {
  MAX_ENVELOPE_BYTES,
  PROTOCOL_VERSION,
  decodeEnvelope as decodeEnvelopeFromPublicApi,
  isCompatibleProtocolVersion,
} from './index.js';
const envelope = {
  protocolVersion: 1,
  project_id: 'project-1',
  tracker_instance_id: 'tracker-1',
  intent: { action: 'update_issue', target: { kind: 'issue', id: 'ISSUE-1' } },
  title: 'Broken login',
  description: 'Steps to reproduce',
  report: { schema_version: 2, title: 'sanitized' },
  options: { includeHar: true, includeScreenshots: false },
  idempotencyKey: 'command-1',
};

describe('report envelope v1', () => {
  it('decodes v1 into the internal connector model', () => {
    expect(decodeEnvelope(envelope)).toEqual({
      ok: true,
      value: {
        protocolVersion: 1,
        projectId: 'project-1',
        trackerInstanceId: 'tracker-1',
        intent: envelope.intent,
        title: envelope.title,
        description: envelope.description,
        report: envelope.report,
        options: envelope.options,
        idempotencyKey: envelope.idempotencyKey,
      },
    });
  });

  it('dispatches through the registry', () => {
    expect(ENVELOPE_DECODERS.get(1)).toBeDefined();
    expect(SUPPORTED_PROTOCOL_VERSIONS.has(1)).toBe(true);
  });

  it('rejects an unsupported version and malformed intent', () => {
    expect(decodeEnvelope({ ...envelope, protocolVersion: 2 })).toMatchObject({
      ok: false,
      error: { code: 'unsupported_protocol_version' },
    });
    expect(decodeEnvelope({ ...envelope, intent: { action: 'update_issue' } })).toMatchObject({
      ok: false,
      error: { code: 'invalid_intent' },
    });
  });

  it('enforces the published text limits', () => {
    expect(decodeEnvelope({ ...envelope, title: 'x'.repeat(MAX_TITLE_LENGTH + 1) })).toMatchObject({
      ok: false,
      error: { code: 'invalid_title' },
    });
    expect(
      decodeEnvelope({ ...envelope, description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1) }),
    ).toMatchObject({ ok: false, error: { code: 'invalid_description' } });
  });
});

  it('exposes the decoder from the package entry point and enforces its byte limit', () => {
    expect(isCompatibleProtocolVersion(PROTOCOL_VERSION)).toBe(true);
    expect(
      decodeEnvelopeFromPublicApi({ ...envelope, report: { payload: 'x'.repeat(MAX_ENVELOPE_BYTES) } }),
    ).toMatchObject({ ok: false, error: { code: 'envelope_too_large' } });
  });
