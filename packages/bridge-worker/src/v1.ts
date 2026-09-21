import {
  MAX_ENVELOPE_BYTES,
  PROTOCOL_VERSION,
  decodeEnvelope,
  mapReportToIssue,
  type Connector,
  type EnvelopeIntent,
  type IntegrationError,
  type IntegrationResult,
  type ReadOperation,
} from '@fairlead/bridge-core';
import type {
  BridgeWorkerDependencies,
  BridgeWorkerEnv,
  ConnectorContext,
  ControlPlaneRpc,
  ResolvedBridgeCredential,
} from './index.js';

export const DEFAULT_REQUEST_TIMEOUT_SECONDS = 15;
const BACKSTOP_GRACE_MS = 2000;
type ErrorBody = { error: IntegrationError };
type ReadEnvelope = {
  protocolVersion: number;
  project_id: string;
  tracker_instance_id: string;
  operation: { type: 'search'; query: string } | { type: 'fetch'; id: string };
};

function response(body: IntegrationResult | ErrorBody | unknown, status: number): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}
function error(code: string, message: string, status: number): Response {
  return response({ error: { code, message } }, status);
}
function token(request: Request): string | null {
  const value = request.headers.get('authorization');
  return value?.startsWith('Bearer ') ? value.slice(7).trim() || null : null;
}
function resolved(value: unknown): value is ResolvedBridgeCredential {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ResolvedBridgeCredential>;
  return (
    typeof candidate.caller_id === 'string' &&
    !!candidate.credential &&
    typeof candidate.credential.token === 'string' &&
    !!candidate.connector &&
    typeof candidate.connector.catalog_type === 'string'
  );
}
function readEnvelope(value: unknown): value is ReadEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<ReadEnvelope>;
  if (
    item.protocolVersion !== 1 ||
    !item.project_id ||
    !item.tracker_instance_id ||
    !item.operation
  )
    return false;
  const operation = item.operation;
  return (
    (operation.type === 'search' && typeof operation.query === 'string') ||
    (operation.type === 'fetch' && typeof operation.id === 'string')
  );
}
async function body(request: Request): Promise<unknown | Response> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_ENVELOPE_BYTES)
    return error('envelope_too_large', `envelope must not exceed ${MAX_ENVELOPE_BYTES} bytes`, 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_ENVELOPE_BYTES)
    return error('envelope_too_large', `envelope must not exceed ${MAX_ENVELOPE_BYTES} bytes`, 413);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return error('invalid_json', 'request body must be JSON', 400);
  }
}
function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}
async function resolve(
  cp: ControlPlaneRpc,
  bearer: string,
  projectId: string,
  instanceId: string,
): Promise<ResolvedBridgeCredential | Response> {
  try {
    const value = await cp.resolveBridgeCredential(bearer, projectId, instanceId);
    if (typeof value === 'object' && value !== null && 'error' in value) {
      const code = (value as { error: string }).error;
      return error(
        code,
        'credential resolution rejected the request',
        code === 'invalid_token' ? 401 : 422,
      );
    }
    return resolved(value)
      ? value
      : error('control_plane_unavailable', 'invalid credential resolution response', 503);
  } catch {
    return error('control_plane_unavailable', 'credential resolution failed', 503);
  }
}
function requestTimeoutSeconds(resolved: ResolvedBridgeCredential): number {
  const value = resolved.request_timeout_seconds;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 300
    ? value
    : DEFAULT_REQUEST_TIMEOUT_SECONDS;
}
/**
 * `signal` covers the request(s) that mutate or read; `attachmentSignal` is a
 * second, later deadline for evidence uploads, so a slow upload can neither
 * cancel a mutation that already succeeded nor turn it into a 504. The backstop
 * sits a little past the attachment deadline, letting connectors report late
 * uploads as failed attachments first.
 */
async function executeWithinTimeout<T>(
  timeoutSeconds: number,
  attachmentSeconds: number,
  work: (signal: AbortSignal, attachmentSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const attachments = new AbortController();
  const timers: ReturnType<typeof setTimeout>[] = [];
  const timeout = new Promise<never>((_resolve, reject) => {
    timers.push(setTimeout(() => controller.abort(), timeoutSeconds * 1000));
    timers.push(setTimeout(() => attachments.abort(), (timeoutSeconds + attachmentSeconds) * 1000));
    timers.push(
      setTimeout(
        () => {
          controller.abort();
          reject(new Error('request_timeout'));
        },
        (timeoutSeconds + attachmentSeconds) * 1000 + BACKSTOP_GRACE_MS,
      ),
    );
  });
  try {
    return await Promise.race([work(controller.signal, attachments.signal), timeout]);
  } finally {
    timers.forEach(clearTimeout);
  }
}
/** The mutation deadline aborts provider requests, which surfaces as an AbortError. */
function timedOut(cause: unknown): boolean {
  return (
    cause instanceof Error && (cause.message === 'request_timeout' || cause.name === 'AbortError')
  );
}
function unsupported(
  connector: Connector,
  action: EnvelopeIntent['action'],
): IntegrationError | null {
  if (connector.capabilities.protocolVersion !== PROTOCOL_VERSION)
    return {
      code: 'connector_protocol_mismatch',
      message: 'resolved connector has an incompatible protocol version',
    };
  return connector.capabilities.supportedActions.includes(action)
    ? null
    : { code: 'unsupported_action', message: `connector does not support action ${action}` };
}
function connectorFor(
  dependencies: BridgeWorkerDependencies,
  credential: ResolvedBridgeCredential,
  signal: AbortSignal,
): Connector | Response {
  const factory = dependencies.connectors.get(credential.connector.catalog_type);
  if (!factory)
    return error(
      'unsupported_connector',
      'no connector is installed for the resolved tracker',
      422,
    );
  const context: ConnectorContext = {
    credential: credential.credential,
    connector: credential.connector,
    signal,
  };
  return factory(context);
}

/** Version-routed envelope API. Report bodies are never logged or persisted. */
export function createEnvelopeBridgeWorker(
  dependencies: BridgeWorkerDependencies,
): ExportedHandler<BridgeWorkerEnv> {
  return {
    async fetch(request, env): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (request.method !== 'POST' || (path !== '/v1/commands' && path !== '/v1/reads'))
        return response({ error: 'not_found' }, 404);
      const bearer = token(request);
      if (!bearer) return error('missing_token', 'Bearer token is required', 401);
      const payload = await body(request);
      if (isResponse(payload)) return payload;
      if (path === '/v1/commands') {
        const decoded = decodeEnvelope(payload);
        if (!decoded.ok)
          return error(
            decoded.error.code,
            decoded.error.message,
            decoded.error.code === 'envelope_too_large' ? 413 : 400,
          );
        const command = decoded.value;
        const credential = await resolve(
          env.CONTROL_PLANE,
          bearer,
          command.projectId,
          command.trackerInstanceId,
        );
        if (isResponse(credential)) return credential;
        try {
          const result = await executeWithinTimeout(
            requestTimeoutSeconds(credential),
            requestTimeoutSeconds(credential),
            async (signal, attachmentSignal): Promise<IntegrationResult | Response> => {
              const connector = connectorFor(dependencies, credential, signal);
              if (isResponse(connector)) return connector;
              const rejected = unsupported(connector, command.intent.action);
              if (rejected)
                return { idempotencyKey: command.idempotencyKey, ok: false, error: rejected };
              return connector.execute(mapReportToIssue(command), { signal, attachmentSignal });
            },
          );
          if (isResponse(result)) return result;
          return response(result, result.ok ? 200 : 422);
        } catch (cause) {
          const timeout = timedOut(cause);
          return response(
            {
              idempotencyKey: command.idempotencyKey,
              ok: false,
              error: timeout
                ? {
                    code: 'request_timeout',
                    message:
                      'connector outcome is unknown; retrying this command can create a duplicate',
                  }
                : { code: 'connector_failure', message: 'connector execution did not complete' },
            },
            timeout ? 504 : 502,
          );
        }
      }
      if (!readEnvelope(payload))
        return error(
          'invalid_request',
          'protocolVersion, routing fields, and operation are required',
          400,
        );
      const credential = await resolve(
        env.CONTROL_PLANE,
        bearer,
        payload.project_id,
        payload.tracker_instance_id,
      );
      if (isResponse(credential)) return credential;
      const read = payload;
      try {
        return await executeWithinTimeout(
          requestTimeoutSeconds(credential),
          0,
          async (signal): Promise<Response> => {
            const connector = connectorFor(dependencies, credential, signal);
            if (isResponse(connector)) return connector;
            if (!connector.read)
              return error('unsupported_read', 'resolved connector does not implement reads', 422);
            const operation: ReadOperation =
              read.operation.type === 'search'
                ? {
                    type: 'search',
                    connectorId: connector.capabilities.connectorId,
                    query: read.operation.query,
                  }
                : {
                    type: 'fetch',
                    connectorId: connector.capabilities.connectorId,
                    id: read.operation.id,
                  };
            return response(await connector.read(operation, { signal }), 200);
          },
        );
      } catch (cause) {
        return timedOut(cause)
          ? error('request_timeout', 'connector read timed out', 504)
          : error('connector_failure', 'connector read did not complete', 502);
      }
    },
  };
}
