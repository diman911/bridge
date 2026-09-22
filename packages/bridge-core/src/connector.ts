import type { ConnectorCommand } from './command.js';
import type { ConnectorAttachment } from './attachment.js';
import type { ConnectorTargets } from './capabilities.js';
import type { IntegrationResult, ReadOperation, ReadResult, AttachmentResult } from './types.js';

/**
 * What a connector supports, rendered by the extension into a generic UI —
 * the extension must not need provider-specific logic per connector.
 */
export interface ConnectorCapabilities {
  /** The protocol version this connector's manifest/execute() speak. */
  protocolVersion: number;
  connectorId: string;
  displayName: string;
  /** Capabilities per target; a missing key means the target is unsupported. */
  targets: ConnectorTargets;
}
export interface ConnectorExecutionOptions {
  /** Connector implementations must pass this to every abortable provider request. */
  signal: AbortSignal;
}
export type ConnectorReadOptions = ConnectorExecutionOptions;
export type ConnectorAttachmentOptions = Pick<ConnectorExecutionOptions, 'signal'>;

/** Implemented per transport (direct in-extension, cloud-mode Bridge worker, private-mode Bridge runner). */
export interface Connector {
  readonly capabilities: ConnectorCapabilities;
  /** Validate the configured provider credential without performing an issue operation. */
  checkCredential?(signal?: AbortSignal): Promise<boolean>;
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
  attach?(
    attachment: ConnectorAttachment,
    options: ConnectorAttachmentOptions,
  ): Promise<AttachmentResult>;
}
