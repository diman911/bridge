/** Version 1 of the extension-to-Bridge write wire contract. */
interface CommandEnvelopeV1 {
  protocolVersion: number;
  project_id: string;
  tracker_instance_id: string;
  idempotencyKey: string;
}

export interface CreateIssueCommandV1 extends CommandEnvelopeV1 {
  type: 'create_issue';
  subject: string;
  description: string;
  technicalSection?: string;
}

export interface UpdateIssueCommandV1 extends CommandEnvelopeV1 {
  type: 'update_issue';
  issueId: string;
  subject?: string;
  description?: string;
  technicalSection?: string;
  onConflict?: 'append' | 'replace';
}

export type EnvelopeV1 = CreateIssueCommandV1 | UpdateIssueCommandV1;
export type CommandType = EnvelopeV1['type'];
