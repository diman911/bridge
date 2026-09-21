import {
  MAX_ENVELOPE_BYTES,
  decodeEnvelope,
  decodeReport,
  mapReportToIssue,
  type Connector,
  type IntegrationCommand,
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
function base64(bytes: Uint8Array): string {
  let text = '';
  for (let start = 0; start < bytes.length; start += 0x8000)
    text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(text);
}
function legacyCommand(
  command: ReturnType<typeof mapReportToIssue>,
  callerId: string,
): IntegrationCommand {
  const action = command.intent.action;
  return {
    protocolVersion: command.protocolVersion,
    target: action === 'create_issue' ? { kind: 'none' } : command.intent.target,
    outcome: 'observation',
    actions: [{ type: action }],
    idempotencyKey: command.idempotencyKey,
    // Caller and connector identity are never request fields. This adapter exists only until B6
    // removes the retired field-level connector command.
    callerId,
    connectorId: 'resolved-by-control-plane',
    title: command.title,
    description: command.renderedDescription,
    evidence: command.artifacts[0]
      ? {
          mode: 'direct_attachment',
          filename: command.artifacts[0].filename,
          dataUrl: `data:${command.artifacts[0].contentType};base64,${base64(command.artifacts[0].data)}`,
        }
      : undefined,
  };
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
        const report = decodeReport(decoded.value.report);
        if (!report.ok) return error(report.error.code, report.error.message, 422);
        const credential = await resolve(
          env.CONTROL_PLANE,
          bearer,
          decoded.value.projectId,
          decoded.value.trackerInstanceId,
        );
        if (isResponse(credential)) return credential;
        const controller = new AbortController();
        const connector = connectorFor(dependencies, credential, controller.signal);
        if (isResponse(connector)) return connector;
        try {
          const result = await connector.execute(
            legacyCommand(mapReportToIssue(decoded.value, report.value), credential.caller_id),
            { signal: controller.signal },
          );
          return response(result, result.ok ? 200 : 422);
        } catch {
          return response(
            {
              idempotencyKey: decoded.value.idempotencyKey,
              ok: false,
              error: { code: 'connector_failure', message: 'connector execution did not complete' },
            },
            502,
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
      const controller = new AbortController();
      const connector = connectorFor(dependencies, credential, controller.signal);
      if (isResponse(connector)) return connector;
      if (!connector.read)
        return error('unsupported_read', 'resolved connector does not implement reads', 422);
      const operation: ReadOperation =
        payload.operation.type === 'search'
          ? {
              type: 'search',
              connectorId: connector.capabilities.connectorId,
              query: payload.operation.query,
            }
          : {
              type: 'fetch',
              connectorId: connector.capabilities.connectorId,
              id: payload.operation.id,
            };
      try {
        return response(await connector.read(operation, { signal: controller.signal }), 200);
      } catch {
        return error('connector_failure', 'connector read did not complete', 502);
      }
    },
  };
}
