export type {
  TargetReference,
  Outcome,
  IntegrationError,
  AttachmentResult,
  AttachmentWarning,
  IntegrationResult,
  ReadOperation,
  IssueSummary,
  ReadResult,
} from './types.js';
export { PROTOCOL_VERSION, isCompatibleProtocolVersion } from './types.js';
export type {
  ConnectorCapabilities,
  Connector,
  ConnectorExecutionOptions,
  ConnectorAttachmentOptions,
} from './connector.js';
export type {
  TargetKind,
  TargetActionMap,
  TargetCapabilities,
  ConnectorTargets,
  ReadKind,
  CommandOperation,
} from './capabilities.js';
export { COMMAND_OPERATION, supportsCommand, supportsRead } from './capabilities.js';
export {
  MAX_ATTACHMENT_BYTES,
  ATTACHMENT_PROJECT_ID_HEADER,
  ATTACHMENT_INTEGRATION_INSTANCE_ID_HEADER,
  type AttachmentMetaV1,
} from './attachment-v1.js';
export type {
  AttachmentMeta,
  AttachmentMetaDecodeResult,
  ConnectorAttachment,
} from './attachment.js';
export { MAX_ATTACHMENT_META_BYTES, decodeAttachmentMetaV1 } from './attachment.js';
export type {
  EnvelopeV1,
  CreateIssueCommandV1,
  UpdateIssueCommandV1,
  CommandType,
} from './envelope-v1.js';
export type {
  DeprecationNotice,
  ResponseMetadata,
  InternalIntegrationCommand,
  DecodeResult,
  EnvelopeDecoder,
} from './envelope.js';
export {
  SUPPORTED_PROTOCOL_VERSIONS,
  DEPRECATED_PROTOCOL_VERSIONS,
  MAX_SUBJECT_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_JSON_REQUEST_BYTES,
  ENVELOPE_DECODERS,
  decodeEnvelopeV1,
  decodeEnvelope,
} from './envelope.js';
export type { ConnectorCommand } from './command.js';
export { toConnectorCommand } from './command.js';
export { mapWithConcurrency } from './concurrency.js';
