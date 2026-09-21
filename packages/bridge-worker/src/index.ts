import { JiraConnector } from '@fairlead/connector-jira';
import { GithubConnector } from '@fairlead/connector-github';
import { AzureDevOpsConnector } from '@fairlead/connector-azure-devops';
import {
  PROTOCOL_VERSION,
  validateIntegrationCommand,
  type Connector,
  type IntegrationCommand,
  type IntegrationError,
  type IntegrationResult,
} from '@fairlead/bridge-core';
const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);

export const DEFAULT_REQUEST_TIMEOUT_SECONDS = 15;
export interface ResolvedBridgeCredential {
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
interface CommandRequest {
  project_id: string;
  tracker_instance_id: string;
  command: IntegrationCommand;
}

function errorResult(idempotencyKey: string, code: string, message: string): IntegrationResult {
  return { idempotencyKey, ok: false, error: { code, message } };
}
function json(
  body: IntegrationResult | { error: IntegrationError; protocolVersion?: number },
  status: number,
): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}
function requestTimeoutSeconds(resolved: ResolvedBridgeCredential): number {
  const value = resolved.request_timeout_seconds;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 300
    ? value
    : DEFAULT_REQUEST_TIMEOUT_SECONDS;
}
function isResolvedBridgeCredential(value: unknown): value is ResolvedBridgeCredential {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Partial<ResolvedBridgeCredential>;
  return (
    typeof result.credential === 'object' &&
    result.credential !== null &&
    typeof result.credential.token === 'string' &&
    typeof result.connector === 'object' &&
    result.connector !== null &&
    typeof result.connector.catalog_type === 'string' &&
    'account_id' in result.connector &&
    'container_key' in result.connector
  );
}
function isControlPlaneError(value: unknown): value is { error: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error?: unknown }).error === 'string'
  );
}
function controlPlaneFailure(idempotencyKey: string, cpError: string): Response {
  switch (cpError) {
    case 'invalid_token':
      return json(
        errorResult(idempotencyKey, 'invalid_token', 'credential resolution rejected the token'),
        401,
      );
    case 'not_found':
    case 'credential_not_found':
      return json(
        errorResult(idempotencyKey, 'credential_not_available', 'credential is not available'),
        404,
      );
    case 'unsupported_catalog_type':
      return json(
        errorResult(idempotencyKey, 'unsupported_connector', 'tracker type is not supported'),
        422,
      );
    default:
      return json(
        errorResult(idempotencyKey, 'control_plane_unavailable', 'credential resolution failed'),
        503,
      );
  }
}
function statusForConnectorResult(result: IntegrationResult): number {
  if (result.ok) return 200;
  if (
    result.error?.httpStatus !== undefined &&
    RETRYABLE_HTTP_STATUSES.has(result.error.httpStatus)
  )
    return result.error.httpStatus;
  return result.error?.retryable ? 503 : 422;
}
function isCommandRequest(value: unknown): value is CommandRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Partial<CommandRequest>;
  return (
    typeof request.project_id === 'string' &&
    request.project_id.length > 0 &&
    typeof request.tracker_instance_id === 'string' &&
    request.tracker_instance_id.length > 0 &&
    typeof request.command === 'object' &&
    request.command !== null
  );
}
function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return token || null;
}
function supportsCommand(
  connector: Connector,
  command: IntegrationCommand,
): IntegrationError | null {
  if (connector.capabilities.protocolVersion !== PROTOCOL_VERSION)
    return {
      code: 'connector_protocol_mismatch',
      message: 'resolved connector has an incompatible protocol version',
    };
  if (connector.capabilities.connectorId !== command.connectorId)
    return {
      code: 'connector_mismatch',
      message: 'command connectorId does not match the resolved connector',
    };
  if (!connector.capabilities.supportedTargets.includes(command.target.kind))
    return {
      code: 'unsupported_target',
      message: `connector does not support target ${command.target.kind}`,
    };
  const unsupportedAction = command.actions.find(
    (action) => !connector.capabilities.supportedActions.includes(action.type),
  );
  return unsupportedAction
    ? {
        code: 'unsupported_action',
        message: `connector does not support action ${unsupportedAction.type}`,
      }
    : null;
}
async function executeWithinTimeout<T>(
  timeoutSeconds: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('request_timeout'));
    }, timeoutSeconds * 1000);
  });
  try {
    return await Promise.race([work(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Builds a testable Worker handler. Production factory wiring lands in tasks 03–05. */
export function createBridgeWorker(
  dependencies: BridgeWorkerDependencies,
): ExportedHandler<BridgeWorkerEnv> {
  return {
    async fetch(request: Request, env: BridgeWorkerEnv): Promise<Response> {
      if (request.method !== 'POST' || new URL(request.url).pathname !== '/commands')
        return Response.json({ error: 'not_found' }, { status: 404 });
      const token = bearerToken(request);
      if (!token)
        return json({ error: { code: 'missing_token', message: 'Bearer token is required' } }, 401);
      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return json({ error: { code: 'invalid_json', message: 'request body must be JSON' } }, 400);
      }
      if (!isCommandRequest(payload))
        return json(
          {
            error: {
              code: 'invalid_request',
              message: 'project_id, tracker_instance_id, and command are required',
            },
          },
          400,
        );
      const validation = validateIntegrationCommand(payload.command);
      if ('error' in validation)
        return json({ error: validation.error, protocolVersion: PROTOCOL_VERSION }, 400);
      // CP verifies the identity token as part of this one credential/config resolution call.
      let resolved: ResolvedBridgeCredential | { error: string };
      try {
        resolved = await env.CONTROL_PLANE.resolveBridgeCredential(
          token,
          payload.project_id,
          payload.tracker_instance_id,
        );
      } catch {
        return json(
          errorResult(
            payload.command.idempotencyKey,
            'control_plane_unavailable',
            'credential resolution failed',
          ),
          503,
        );
      }
      if (isControlPlaneError(resolved))
        return controlPlaneFailure(payload.command.idempotencyKey, resolved.error);
      if (!isResolvedBridgeCredential(resolved))
        return json(
          errorResult(
            payload.command.idempotencyKey,
            'control_plane_unavailable',
            'credential resolution returned an invalid response',
          ),
          503,
        );
      const factory = dependencies.connectors.get(resolved.connector.catalog_type);
      if (!factory)
        return json(
          errorResult(
            payload.command.idempotencyKey,
            'unsupported_connector',
            'no connector is installed for the resolved tracker',
          ),
          422,
        );
      try {
        const result = await executeWithinTimeout(
          requestTimeoutSeconds(resolved),
          async (signal) => {
            const connector = factory({
              credential: resolved.credential,
              connector: resolved.connector,
              signal,
            });
            const capabilityError = supportsCommand(connector, payload.command);
            return capabilityError
              ? errorResult(
                  payload.command.idempotencyKey,
                  capabilityError.code,
                  capabilityError.message,
                )
              : connector.execute(payload.command, { signal });
          },
        );
        return json(result, statusForConnectorResult(result));
      } catch (error) {
        const code =
          error instanceof Error && error.message === 'request_timeout'
            ? 'request_timeout'
            : 'connector_failure';
        return json(
          errorResult(
            payload.command.idempotencyKey,
            code,
            code === 'request_timeout'
              ? 'connector outcome is unknown; retrying this command can create a duplicate'
              : 'connector execution did not complete',
          ),
          code === 'request_timeout' ? 504 : 502,
        );
      }
    },
  };
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

export default createBridgeWorker({ connectors: productionConnectors });
