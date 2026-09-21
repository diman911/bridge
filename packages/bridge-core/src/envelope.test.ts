import { describe, expect, it } from 'vitest';
import {
  ENVELOPE_DECODERS,
  MAX_DESCRIPTION_LENGTH,
  MAX_SUBJECT_LENGTH,
  MAX_TECHNICAL_SECTION_LENGTH,
  SUPPORTED_PROTOCOL_VERSIONS,
  decodeEnvelope,
} from './envelope.js';
import { PROTOCOL_VERSION, isCompatibleProtocolVersion } from './index.js';

const update = {
  protocolVersion: 1,
  project_id: 'project-1',
  tracker_instance_id: 'tracker-1',
  type: 'update_issue',
  issueId: 'ISSUE-1',
  subject: 'Broken login',
  description: 'Steps to reproduce',
  technicalSection: 'Browser: Chromium',
  idempotencyKey: 'command-1',
};

describe('command envelope v1', () => {
  it('decodes the narrow update command and ignores additive fields', () => {
    expect(decodeEnvelope({ ...update, futureField: true })).toEqual({
      ok: true,
      value: {
        protocolVersion: 1,
        projectId: 'project-1',
        trackerInstanceId: 'tracker-1',
        type: 'update_issue',
        issueId: 'ISSUE-1',
        subject: 'Broken login',
        description: 'Steps to reproduce',
        technicalSection: 'Browser: Chromium',
        idempotencyKey: 'command-1',
      },
    });
  });

  it('dispatches through the protocol registry', () => {
    expect(ENVELOPE_DECODERS.get(1)).toBeDefined();
    expect(SUPPORTED_PROTOCOL_VERSIONS.has(1)).toBe(true);
    expect(isCompatibleProtocolVersion(PROTOCOL_VERSION)).toBe(true);
  });

  it('rejects unsupported versions and the superseded wire shape', () => {
    expect(decodeEnvelope({ ...update, protocolVersion: 2 })).toMatchObject({
      ok: false,
      error: { code: 'unsupported_protocol_version' },
    });
    expect(
      decodeEnvelope({ ...update, type: undefined, intent: { action: 'update_issue' } }),
    ).toMatchObject({
      ok: false,
      error: { code: 'invalid_envelope' },
    });
  });

  it('validates command variants and meaningful updates', () => {
    const { issueId: _issueId, ...create } = { ...update, type: 'create_issue', description: '' };
    expect(decodeEnvelope(create)).toMatchObject({ ok: true });
    expect(decodeEnvelope({ ...create, issueId: 'X' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_command' },
    });
    expect(
      decodeEnvelope({
        protocolVersion: 1,
        project_id: 'p',
        tracker_instance_id: 't',
        type: 'update_issue',
        issueId: 'X',
        idempotencyKey: 'k',
      }),
    ).toMatchObject({ ok: false, error: { code: 'invalid_command' } });
    expect(
      decodeEnvelope({ ...update, onConflict: 'replace', description: undefined }),
    ).toMatchObject({
      ok: false,
      error: { code: 'invalid_command' },
    });
  });

  it('accepts the defined onConflict combinations and rejects undefined values', () => {
    const { technicalSection: _technicalSection, ...withoutTechnicalSection } = update;
    expect(
      decodeEnvelope({ ...update, onConflict: 'append', technicalSection: 'replacement block' }),
    ).toMatchObject({ ok: true });
    expect(decodeEnvelope({ ...update, onConflict: 'append', technicalSection: '' })).toMatchObject(
      { ok: true },
    );
    expect(decodeEnvelope({ ...withoutTechnicalSection, onConflict: 'replace' })).toMatchObject({
      ok: true,
    });
    expect(
      decodeEnvelope({ ...update, onConflict: 'replace', technicalSection: '' }),
    ).toMatchObject({ ok: true });
    expect(decodeEnvelope({ ...update, onConflict: undefined })).toMatchObject({
      ok: false,
      error: { code: 'invalid_command' },
    });
  });

  it('enforces text limits while allowing technical-section deletion', () => {
    expect(
      decodeEnvelope({ ...update, subject: 'x'.repeat(MAX_SUBJECT_LENGTH + 1) }),
    ).toMatchObject({
      ok: false,
      error: { code: 'invalid_command' },
    });
    expect(
      decodeEnvelope({ ...update, description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1) }),
    ).toMatchObject({
      ok: false,
      error: { code: 'invalid_command' },
    });
    expect(
      decodeEnvelope({ ...update, technicalSection: 'x'.repeat(MAX_TECHNICAL_SECTION_LENGTH + 1) }),
    ).toMatchObject({ ok: false, error: { code: 'invalid_command' } });
    expect(decodeEnvelope({ ...update, technicalSection: '' })).toMatchObject({ ok: true });
  });
});
