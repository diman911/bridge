// First draft of the generic integration contract described in
// ../../../chrome-extension/docs/plans/integration-connector-gateway.md
// ("Generic integration contract"). Exact shapes are expected to change as
// Phase 1 (see docs/plans/00-bootstrap.md) firms up — this is a starting
// point for that work, not a stable contract yet.

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
}

export interface IntegrationResult {
  idempotencyKey: string;
  ok: boolean;
  issueUrl?: string;
  error?: IntegrationError;
}
