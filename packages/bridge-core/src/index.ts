export type {
  TargetReference,
  Outcome,
  IntegrationAction,
  EvidenceReference,
  IntegrationCommand,
  IntegrationError,
  AttachmentResult,
  IntegrationResult,
  ReadOperation,
  IssueSummary,
  IssueAttachmentSummary,
  ReadResult,
} from './types.js';
export { PROTOCOL_VERSION, isCompatibleProtocolVersion } from './types.js';
export type { ConnectorCapabilities, Connector, ConnectorExecutionOptions } from './connector.js';
export { validateIntegrationCommand } from './validation.js';
