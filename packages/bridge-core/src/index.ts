export type {
  TargetReference,
  Outcome,
  IntegrationError,
  AttachmentResult,
  IntegrationResult,
  ReadOperation,
  IssueSummary,
  ReadResult,
} from './types.js';
export { PROTOCOL_VERSION, isCompatibleProtocolVersion } from './types.js';
export type { ConnectorCapabilities, Connector, ConnectorExecutionOptions } from './connector.js';
export type { EnvelopeV1, EnvelopeIntent, EvidenceOptions } from './envelope-v1.js';
export type {
  DeprecationNotice,
  ResponseMetadata,
  InternalIntegrationCommand,
  DecodeResult,
  EnvelopeDecoder,
} from './envelope.js';
export {
  SUPPORTED_PROTOCOL_VERSIONS,
  MAX_ENVELOPE_BYTES,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  ENVELOPE_DECODERS,
  decodeEnvelopeV1,
  decodeEnvelope,
} from './envelope.js';
export type { BridgeReport, ReportDecodeResult } from './report.js';
export {
  CURRENT_REPORT_SCHEMA_VERSION,
  SUPPORTED_REPORT_SCHEMA_VERSIONS,
  decodeReport,
} from './report.js';
export type { ReportArtifact, ConnectorCommand } from './report-mapping.js';
export type { TechnicalContext, AdfNode, AdfDocument } from './description.js';
export { TECHNICAL_HEADING, mergeMarkdown, mergeHtml, mergeAdf } from './description.js';
export { mapReportToIssue } from './report-mapping.js';
