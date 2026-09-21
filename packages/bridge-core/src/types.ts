// Generic integration contract described in
// ../../../chrome-extension/docs/plans/integration-connector-gateway.md
// ("Generic integration contract", "Protocol v1 scope"). Stabilized per
// docs/plans/01-stabilize-contract.md.

import { SUPPORTED_PROTOCOL_VERSIONS } from './envelope.js';

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
  return SUPPORTED_PROTOCOL_VERSIONS.has(version);
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

/** Outcome of one `POST /v1/attachments` upload. */
export interface AttachmentResult {
  /** Name of the uploaded file this outcome is for. */
  filename: string;
  ok: boolean;
  error?: IntegrationError;
  warnings?: AttachmentWarning[];
}

export interface AttachmentWarning {
  code: 'previous_version_not_removed';
  message: string;
}

export interface IntegrationResult {
  /** Reflects the issue mutation only; attachments are uploaded separately. */
  ok: boolean;
  /** Provider issue identifier, required by the subsequent attachment route. */
  issueId?: string;
  issueUrl?: string;
  error?: IntegrationError;
  /** Additive response metadata for protocol lifecycle notices. */
  metadata?: import('./envelope.js').ResponseMetadata;
}

/**
 * The provider-neutral read contract (search issues / fetch issue) the
 * generic issue picker needs — the source plan describes these in prose
 * only ("Protocol v1 scope"); this is their first typed shape. Deliberately
 * separate from ConnectorCommand/IntegrationResult: a read has no target
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
  /** Additive response metadata for protocol lifecycle notices. */
  metadata?: import('./envelope.js').ResponseMetadata;
}
