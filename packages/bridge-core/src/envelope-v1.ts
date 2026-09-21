/** Version 1 of the extension-to-Bridge write wire contract. */
interface CommandEnvelopeV1 {
  protocolVersion: number;
  project_id: string;
  integration_instance_id: string;
}

export interface CreateIssueCommandV1 extends CommandEnvelopeV1 {
  type: 'create_issue';
  subject: string;
  description: string;
}

export interface UpdateIssueCommandV1 extends CommandEnvelopeV1 {
  type: 'update_issue';
  issueId: string;
  subject?: string;
  description?: string;
}

export type EnvelopeV1 = CreateIssueCommandV1 | UpdateIssueCommandV1;
export type CommandType = EnvelopeV1['type'];
