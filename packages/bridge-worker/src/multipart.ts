import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_META_BYTES,
  decodeAttachmentMetaV1,
  type AttachmentMeta,
  type ConnectorAttachment,
} from '@fairlead/bridge-core';

const MAX_PART_HEADERS_BYTES = 8 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

export class MultipartError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: Record<string, number>,
  ) {
    super(message);
  }
}

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}
function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
  const joined = new Uint8Array(first.byteLength + second.byteLength);
  joined.set(first);
  joined.set(second, first.byteLength);
  return joined;
}
function find(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.byteLength - needle.byteLength; i++) {
    for (let j = 0; j < needle.byteLength; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
function boundaryFrom(request: Request): string {
  const contentType = request.headers.get('content-type') ?? '';
  const match = /^multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+))$/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || boundary.length > 70 || !/^[0-9A-Za-z'()+_,./:=?-]+$/.test(boundary))
    throw new MultipartError('invalid_multipart', 'multipart/form-data boundary is required');
  return boundary;
}
function parseHeaders(raw: Uint8Array): Map<string, string> {
  let text: string;
  try {
    text = decoder.decode(raw);
  } catch {
    throw new MultipartError('invalid_multipart', 'part headers must be UTF-8');
  }
  const headers = new Map<string, string>();
  for (const line of text.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon <= 0) throw new MultipartError('invalid_multipart', 'invalid part header');
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return headers;
}
function disposition(headers: Map<string, string>): { name: string; filename?: string } {
  const value = headers.get('content-disposition') ?? '';
  const name = /(?:^|;)\s*name="([^"]+)"/i.exec(value)?.[1];
  const filename = /(?:^|;)\s*filename="([^"]*)"/i.exec(value)?.[1];
  if (!/^form-data(?:;|$)/i.test(value) || !name)
    throw new MultipartError('invalid_multipart', 'part content-disposition is invalid');
  return { name, ...(filename === undefined ? {} : { filename }) };
}

export class AttachmentMultipartReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private buffered: Uint8Array<ArrayBufferLike> = new Uint8Array();
  private readonly delimiter: Uint8Array;

  constructor(
    request: Request,
    private readonly boundary = boundaryFrom(request),
  ) {
    if (!request.body) throw new MultipartError('invalid_multipart', 'multipart body is required');
    this.reader = request.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    this.delimiter = bytes(`\r\n--${this.boundary}`);
  }

  private async pull(): Promise<void> {
    const next = await this.reader.read();
    if (next.done) throw new MultipartError('invalid_multipart', 'multipart body ended early');
    this.buffered = concat(this.buffered, next.value);
  }

  private async take(count: number): Promise<Uint8Array> {
    while (this.buffered.byteLength < count) await this.pull();
    const value = this.buffered.slice(0, count);
    this.buffered = this.buffered.slice(count);
    return value;
  }

  private async expect(value: string): Promise<void> {
    const expected = bytes(value);
    const actual = await this.take(expected.byteLength);
    if (find(actual, expected) !== 0)
      throw new MultipartError('invalid_multipart', `expected ${JSON.stringify(value)}`);
  }

  private async until(marker: Uint8Array, limit: number, code: string): Promise<Uint8Array> {
    while (true) {
      const index = find(this.buffered, marker);
      if (index >= 0) {
        if (index > limit) throw new MultipartError(code, 'multipart part exceeds its limit', 413);
        const value = this.buffered.slice(0, index);
        this.buffered = this.buffered.slice(index + marker.byteLength);
        return value;
      }
      if (this.buffered.byteLength > limit + marker.byteLength)
        throw new MultipartError(code, 'multipart part exceeds its limit', 413);
      await this.pull();
    }
  }

  private async headers(): Promise<Map<string, string>> {
    return parseHeaders(
      await this.until(bytes('\r\n\r\n'), MAX_PART_HEADERS_BYTES, 'invalid_multipart'),
    );
  }

  async readMeta(): Promise<AttachmentMeta> {
    await this.expect(`--${this.boundary}\r\n`);
    const headers = await this.headers();
    const part = disposition(headers);
    if (part.name !== 'meta' || part.filename !== undefined)
      throw new MultipartError('invalid_multipart', 'meta must be the first non-file part');
    if (headers.get('content-type') !== 'application/json')
      throw new MultipartError('invalid_multipart', 'meta Content-Type must be application/json');
    const raw = await this.until(
      this.delimiter,
      MAX_ATTACHMENT_META_BYTES,
      'attachment_meta_too_large',
    );
    let json: unknown;
    try {
      json = JSON.parse(decoder.decode(raw));
    } catch {
      throw new MultipartError('invalid_attachment_meta', 'meta must contain valid JSON');
    }
    const decoded = decodeAttachmentMetaV1(json);
    if (!decoded.ok) throw new MultipartError(decoded.error.code, decoded.error.message, 422);
    return decoded.value;
  }

  async file(meta: AttachmentMeta): Promise<ConnectorAttachment> {
    await this.expect('\r\n');
    const headers = await this.headers();
    const part = disposition(headers);
    if (part.name !== 'file' || part.filename !== meta.filename)
      throw new MultipartError('invalid_multipart', 'file must be second and match meta.filename');
    const contentType = headers.get('content-type');
    if (contentType !== meta.contentType)
      throw new MultipartError(
        'invalid_multipart',
        'file Content-Type must match meta.contentType',
      );

    const state = { exceeded: false, actualBytes: 0 };
    const finalDelimiter = bytes(`\r\n--${this.boundary}--`);
    const data = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        const exceedsLimit = async (chunk: Uint8Array): Promise<boolean> => {
          state.actualBytes += chunk.byteLength;
          if (state.actualBytes <= MAX_ATTACHMENT_BYTES) return false;
          state.exceeded = true;
          controller.error(
            new MultipartError('attachment_too_large', 'attachment exceeds limit', 413, {
              limitBytes: MAX_ATTACHMENT_BYTES,
              actualBytes: state.actualBytes,
            }),
          );
          await this.reader.cancel('attachment exceeds limit');
          return true;
        };
        while (true) {
          const index = find(this.buffered, finalDelimiter);
          if (index >= 0) {
            const chunk = this.buffered.slice(0, index);
            if (await exceedsLimit(chunk)) return;
            if (chunk.byteLength) controller.enqueue(chunk);
            this.buffered = this.buffered.slice(index + finalDelimiter.byteLength);
            controller.close();
            await this.reader.cancel('multipart file consumed');
            return;
          }
          const safe = this.buffered.byteLength - finalDelimiter.byteLength + 1;
          if (safe > 0) {
            const chunk = this.buffered.slice(0, safe);
            this.buffered = this.buffered.slice(safe);
            if (await exceedsLimit(chunk)) return;
            controller.enqueue(chunk);
            return;
          }
          await this.pull();
        }
      },
      cancel: async (reason) => this.reader.cancel(reason),
    });
    return {
      protocolVersion: meta.protocolVersion,
      issueId: meta.issueId,
      filename: meta.filename,
      contentType: meta.contentType,
      data,
      idempotencyKey: meta.idempotencyKey,
      limitState: state,
    };
  }
}
