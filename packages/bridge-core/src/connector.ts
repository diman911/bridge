import type { EnvelopeIntent } from './envelope-v1.js';
import type { ConnectorCommand } from './report-mapping.js';
import type {
  IntegrationResult,
  Outcome,
  ReadOperation,
  ReadResult,
  TargetReference,
} from './types.js';

/**
 * What a connector supports, rendered by the extension into a generic UI —
 * the extension must not need provider-specific logic per connector.
 */
export interface ConnectorCapabilities {
  /** The protocol version this connector's manifest/execute() speak. */
  protocolVersion: number;
  connectorId: string;
  displayName: string;
  supportedTargets: TargetReference['kind'][];
  supportedActions: EnvelopeIntent['action'][];
  /** Maps a generic Outcome to the connector's own status/verdict vocabulary. */
  verdictMappings: Partial<Record<Outcome, string>>;
}
export interface ConnectorExecutionOptions {
  /** Connector implementations must pass this to every abortable provider request. */
  signal: AbortSignal;
}
export type ConnectorReadOptions = ConnectorExecutionOptions;

/** Implemented per transport (direct in-extension, cloud-mode Bridge worker, private-mode Bridge runner). */
export interface Connector {
  readonly capabilities: ConnectorCapabilities;
  execute(
    command: ConnectorCommand,
    options: ConnectorExecutionOptions,
  ): Promise<IntegrationResult>;
  /**
   * Search/fetch — the provider-neutral read contract the generic issue
   * picker needs (source plan, "Protocol v1 scope"). Optional: a
   * write-only connector (e.g. a future share-only-style connector) need
   * not implement it, but every v1 issue-tracker connector (Jira, GitHub,
   * Azure DevOps) does.
   */
  read?(operation: ReadOperation, options: ConnectorReadOptions): Promise<ReadResult>;
}
