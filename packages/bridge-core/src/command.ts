import type { InternalIntegrationCommand } from './envelope.js';

export type ConnectorCommand =
  | {
      protocolVersion: number;
      type: 'create_issue';
      subject: string;
      description: string;
      technicalSection?: string;
      idempotencyKey: string;
    }
  | {
      protocolVersion: number;
      type: 'update_issue';
      issueId: string;
      subject?: string;
      description?: string;
      technicalSection?: string;
      onConflict?: 'append' | 'replace';
      idempotencyKey: string;
    };

export function toConnectorCommand(command: InternalIntegrationCommand): ConnectorCommand {
  const {
    projectId: _projectId,
    trackerInstanceId: _trackerInstanceId,
    ...connectorCommand
  } = command;
  return connectorCommand;
}
