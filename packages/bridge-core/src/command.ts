import type { InternalIntegrationCommand } from './envelope.js';

export type ConnectorCommand =
  | {
      protocolVersion: number;
      type: 'create_issue';
      subject: string;
      description: string;
    }
  | {
      protocolVersion: number;
      type: 'update_issue';
      issueId: string;
      subject?: string;
      description?: string;
    };

export function toConnectorCommand(command: InternalIntegrationCommand): ConnectorCommand {
  const {
    projectId: _projectId,
    integrationInstanceId: _integrationInstanceId,
    ...connectorCommand
  } = command;
  return connectorCommand;
}
