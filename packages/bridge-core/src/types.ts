// Generic integration contract described in
// ../../../chrome-extension/docs/plans/integration-connector-gateway.md
// ("Generic integration contract", "Protocol v1 scope"). Stabilized per
// docs/plans/01-stabilize-contract.md.

/**
 * Protocol version this package implements. A command/manifest carries this
 * so a version mismatch is detected explicitly rather than by a connector
 * or Bridge guessing at an unfamiliar field shape — see the source plan's
 * "Extensibility constraints" ("Bridge must reject an incompatible version
 * clearly and extensions must tolerate additive capability fields they do
 * not understand").
 */
export const PROTOCOL_VERSION = 1;

/** Whether a command/manifest's declared version is one this package can execute. */
export function isCompatibleProtocolVersion(version: number): boolean {
  return version === PROTOCOL_VERSION;
}

/** What the command acts on. `none` covers context-handoff / share-only flows. */
export type TargetReference =
  | { kind: 'issue'; id: string }
  | { kind: 'test_case'; id: string }
  | { kind: 'test_run'; id: string }
  | { kind: 'incident'; id: string }
  | { kind: 'none' };

export type Outcome =
  'passed' | 'failed' | 'blocked' | 'incomplete' | 'verified' | 'not_verified' | 'observation';

export type IntegrationAction =
  | { type: 'create_issue' }
  | { type: 'update_issue' }
  | { type: 'transition_issue'; toStatus: string }
  | { type: 'add_comment' }
  | { type: 'attach_evidence' }
  | { type: 'write_test_result' }
  | { type: 'share_only' };

/**
 * By default a reference to sanitized evidence already in the Data Plane —
 * never the full recording body. `direct_attachment` exists only for the
 * `direct` transport (no external Bridge involved).
 */
export type EvidenceReference =
  | { mode: 'data_plane_reference'; sessionUrl: string }
  | { mode: 'direct_attachment'; dataUrl: string; filename: string };

export interface IntegrationCommand {
  /** Must equal PROTOCOL_VERSION for this package's build to execute it. */
  protocolVersion: number;
  target: TargetReference;
  outcome: Outcome;
  actions: IntegrationAction[];
  evidence?: EvidenceReference;
  /** Caller-generated; connectors must treat re-delivery of the same key as a no-op. */
  idempotencyKey: string;
  callerId: string;
  connectorId: string;
  projectContext?: Record<string, string>;
}

export interface IntegrationError {
  code: string;
  message: string;
  /**
   * Optional transport classification supplied by a connector. The Bridge
   * exposes only retry-safe upstream statuses (429/502/503/504); validation
   * failures continue to use 422.
   */
  httpStatus?: 429 | 502 | 503 | 504;
  /** A transient failure without a more-specific HTTP status. */
  retryable?: boolean;
}

/**
 * Per-file attachment outcome. A command can report `ok: true` overall
 * (the issue mutation itself succeeded) with one or more attachment
 * failures here — see the source plan's "Protocol v1 scope", "Decided
 * (2026-09-21): partial success."
 */
export interface AttachmentResult {
  reference: EvidenceReference;
  ok: boolean;
  error?: IntegrationError;
}

export interface IntegrationResult {
  idempotencyKey: string;
  /** Reflects the issue mutation only — see `attachments` for per-file outcomes. */
  ok: boolean;
  issueUrl?: string;
  attachments?: AttachmentResult[];
  error?: IntegrationError;
}

/**
 * The provider-neutral read contract (search issues / fetch issue) the
 * generic issue picker needs — the source plan describes these in prose
 * only ("Protocol v1 scope"); this is their first typed shape. Deliberately
 * separate from IntegrationCommand/IntegrationResult: a read has no target
 * mutation, no idempotency concern, and a different result shape (a list,
 * or a single issue) than a write's single artifact reference.
 */
export type ReadOperation =
  | { type: 'search'; connectorId: string; query: string; projectContext?: Record<string, string> }
  | { type: 'fetch'; connectorId: string; id: string };

export interface IssueSummary {
  id: string;
  title: string;
  url: string;
  status?: string;
}

export interface ReadResult {
  ok: boolean;
  /** Present when `ok` and the operation was `search`. */
  issues?: IssueSummary[];
  /** Present when `ok` and the operation was `fetch`. */
  issue?: IssueSummary;
  error?: IntegrationError;
}
