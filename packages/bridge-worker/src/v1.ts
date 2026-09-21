import {
  DEPRECATED_PROTOCOL_VERSIONS,
  ENVELOPE_DECODERS,
  MAX_JSON_REQUEST_BYTES,
  PROTOCOL_VERSION,
  decodeEnvelope,
  toConnectorCommand,
  type Connector,
  type CommandType,
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
type ReadEnvelope = {
  protocolVersion: number;
  project_id: string;
  tracker_instance_id: string;
  operation: { type: 'search'; query: string } | { type: 'fetch'; id: string };
};

function response(body: unknown, status: number): Response {
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
async function body(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const bytes = Number(declared);
    if (Number.isFinite(bytes) && bytes > MAX_JSON_REQUEST_BYTES)
      return error(
        'request_too_large',
        `JSON request must not exceed ${MAX_JSON_REQUEST_BYTES} bytes`,
        413,
      );
  }
  if (!request.body) return error('invalid_json', 'request body must be JSON', 400);
  const reader = request.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_JSON_REQUEST_BYTES) {
      await reader.cancel('request body exceeds JSON limit');
      return error(
        'request_too_large',
        `JSON request must not exceed ${MAX_JSON_REQUEST_BYTES} bytes`,
        413,
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    return JSON.parse(text);
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
    if (
      typeof value === 'object' &&
      value !== null &&
      'error' in value &&
      typeof value.error === 'string'
    ) {
      const code = value.error;
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
function unsupported(connector: Connector, action: CommandType): IntegrationError | null {
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

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Routing fields only; the command is decoded after authentication. */
function commandRouting(
  payload: unknown,
): { version: number; projectId: string; trackerInstanceId: string } | Response {
  if (!record(payload) || typeof payload.protocolVersion !== 'number')
    return error('invalid_envelope', 'envelope protocolVersion is required', 400);
  if (!ENVELOPE_DECODERS.has(payload.protocolVersion))
    return error(
      'unsupported_protocol_version',
      `envelope protocolVersion ${payload.protocolVersion} is not supported`,
      400,
    );
  if (
    typeof payload.project_id !== 'string' ||
    !payload.project_id ||
    typeof payload.tracker_instance_id !== 'string' ||
    !payload.tracker_instance_id
  )
    return error('invalid_envelope', 'project_id and tracker_instance_id are required', 400);
  return {
    version: payload.protocolVersion,
    projectId: payload.project_id,
    trackerInstanceId: payload.tracker_instance_id,
  };
}

/** Version-routed API. Command bodies are never logged or persisted. */
export function createEnvelopeBridgeWorker(
  dependencies: BridgeWorkerDependencies,
): ExportedHandler<BridgeWorkerEnv> {
  const deprecations = dependencies.deprecations ?? DEPRECATED_PROTOCOL_VERSIONS;
  /** Attaches the end-of-support notice, if any, to a command or read result. */
  const notify = <T extends object>(version: number, result: T): T => {
    const deprecation = deprecations.get(version);
    return deprecation ? { ...result, metadata: { deprecation } } : result;
  };
  return {
    async fetch(request: Request, env: BridgeWorkerEnv): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (request.method !== 'POST' || (path !== '/v1/commands' && path !== '/v1/reads'))
        return response({ error: 'not_found' }, 404);
      const bearer = token(request);
      if (!bearer) return error('missing_token', 'Bearer token is required', 401);
      const payload = await body(request);
      if (isResponse(payload)) return payload;
      if (path === '/v1/commands') {
        const routing = commandRouting(payload);
        if (isResponse(routing)) return routing;
        // Resolve the authenticated caller before decoding caller-controlled command fields.
        const credential = await resolve(
          env.CONTROL_PLANE,
          bearer,
          routing.projectId,
          routing.trackerInstanceId,
        );
        if (isResponse(credential)) return credential;
        const decoded = decodeEnvelope(payload);
        if (!decoded.ok)
          return error(
            decoded.error.code,
            decoded.error.message,
            decoded.error.code === 'invalid_command' ? 422 : 400,
          );
        const command = decoded.value;
        try {
          const result = await executeWithinTimeout(
            requestTimeoutSeconds(credential),
            requestTimeoutSeconds(credential),
            async (signal, attachmentSignal): Promise<IntegrationResult | Response> => {
              const connector = connectorFor(dependencies, credential, signal);
              if (isResponse(connector)) return connector;
              const rejected = unsupported(connector, command.type);
              if (rejected)
                return { idempotencyKey: command.idempotencyKey, ok: false, error: rejected };
              return connector.execute(toConnectorCommand(command), { signal, attachmentSignal });
            },
          );
          if (isResponse(result)) return result;
          return response(notify(routing.version, result), result.ok ? 200 : 422);
        } catch (cause) {
          const timeout = timedOut(cause);
          return response(
            notify(routing.version, {
              idempotencyKey: command.idempotencyKey,
              ok: false,
              error: timeout
                ? {
                    code: 'request_timeout',
                    message:
                      'connector outcome is unknown; retrying this command can create a duplicate',
                  }
                : { code: 'connector_failure', message: 'connector execution did not complete' },
            }),
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
            return response(
              notify(read.protocolVersion, await connector.read(operation, { signal })),
              200,
            );
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
