/**
 * Version 1 of the extension-to-Bridge wire contract.
 *
 * This module intentionally contains declarations only. The extension vendors
 * it verbatim; decoding and validation live in envelope.ts in this package.
 */

export type EnvelopeIntent =
  | { action: 'create_issue' }
  | {
      action: 'update_issue' | 'add_comment';
      target: { kind: 'issue'; id: string };
    };

/** Tracker-neutral selection of report-derived evidence. */
export interface EvidenceOptions {
  includeHar: boolean;
  includeScreenshots: boolean;
}

/**
 * The report has its own schema-version lifecycle. It remains opaque at this
 * boundary until the report-schema source is chosen (B3).
 */
export type ReportEnvelopePayload = Record<string, unknown>;

export interface EnvelopeV1 {
  protocolVersion: number;
  project_id: string;
  tracker_instance_id: string;
  intent: EnvelopeIntent;
  title: string;
  description: string;
  report: ReportEnvelopePayload;
  options: EvidenceOptions;
  idempotencyKey: string;
}
