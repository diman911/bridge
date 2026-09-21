import { JiraConnector } from '@fairlead/connector-jira';
import { GithubConnector } from '@fairlead/connector-github';
import { AzureDevOpsConnector } from '@fairlead/connector-azure-devops';
import { createEnvelopeBridgeWorker } from './v1.js';
import type { Connector } from '@fairlead/bridge-core';

export interface ResolvedBridgeCredential {
  /** Verified identity supplied by control-plane C3; never caller input. */
  caller_id: string;
  credential: {
    token: string;
    metadata: Record<string, unknown> | null;
    auth_type: 'oauth' | 'api_token';
  };
  connector: {
    catalog_type: string;
    host: string | null;
    port: number | null;
    account_id: string | null;
    account_url: string | null;
    container_id: string | null;
    container_key: string | null;
    container_name: string | null;
  };
  request_timeout_seconds?: number;
}
export interface ControlPlaneRpc {
  resolveBridgeCredential(
    token: string,
    projectId: string,
    integrationInstanceId: string,
  ): Promise<ResolvedBridgeCredential | { error: string }>;
}
export interface ConnectorContext {
  credential: ResolvedBridgeCredential['credential'];
  connector: ResolvedBridgeCredential['connector'];
  signal: AbortSignal;
}
/** Connector packages register factories; this Worker never branches on provider type. */
export type ConnectorFactory = (context: ConnectorContext) => Connector;
export interface BridgeWorkerEnv {
  CONTROL_PLANE: ControlPlaneRpc;
}
export interface BridgeWorkerDependencies {
  connectors: ReadonlyMap<string, ConnectorFactory>;
}
function required(value: string | null, field: string): string {
  if (!value) throw new Error(`missing trusted connector ${field}`);
  return value;
}

const productionConnectors = new Map<string, ConnectorFactory>([
  [
    'jira_cloud',
    (context) =>
      new JiraConnector({
        baseUrl: required(context.connector.account_url, 'account_url'),
        projectKey: required(context.connector.container_key, 'container_key'),
        token: context.credential.token,
        authType: context.credential.auth_type,
        email:
          typeof context.credential.metadata?.email === 'string'
            ? context.credential.metadata.email
            : undefined,
      }),
  ],
  [
    'github',
    (context) =>
      new GithubConnector({
        owner: required(context.connector.account_id, 'account_id'),
        repo: required(context.connector.container_key, 'container_key'),
        token: context.credential.token,
      }),
  ],
  [
    'azure_devops',
    (context) =>
      new AzureDevOpsConnector({
        organization: required(context.connector.account_id, 'account_id'),
        project: required(context.connector.container_key, 'container_key'),
        token: context.credential.token,
        authType: context.credential.auth_type,
      }),
  ],
]);

export default createEnvelopeBridgeWorker({ connectors: productionConnectors });
