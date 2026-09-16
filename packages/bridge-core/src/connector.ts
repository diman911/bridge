import type { IntegrationCommand, IntegrationResult, Outcome, TargetReference } from './types.js';

/**
 * What a connector supports, rendered by the extension into a generic UI —
 * the extension must not need provider-specific logic per connector.
 */
export interface ConnectorCapabilities {
  connectorId: string;
  displayName: string;
  supportedTargets: TargetReference['kind'][];
  supportedActions: IntegrationCommand['actions'][number]['type'][];
  /** Maps a generic Outcome to the connector's own status/verdict vocabulary. */
  verdictMappings: Partial<Record<Outcome, string>>;
}

/** Implemented per transport (direct in-extension, cloud-mode Bridge worker, private-mode Bridge runner). */
export interface Connector {
  readonly capabilities: ConnectorCapabilities;
  execute(command: IntegrationCommand): Promise<IntegrationResult>;
}
