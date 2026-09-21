import type { InternalIntegrationCommand } from './envelope.js';
import type { EnvelopeIntent } from './envelope-v1.js';
import type { TechnicalContext } from './description.js';

export interface ReportArtifact {
  filename: string;
  contentType: string;
  data: Uint8Array;
}

/**
 * What a connector receives: the user-authored fields plus what Bridge derived
 * from the report. The report body itself is not carried further (ADR-011).
 */
export interface ConnectorCommand {
  protocolVersion: number;
  intent: EnvelopeIntent;
  title: string;
  /** User-authored description, without the Fairlead block. */
  description: string;
  technicalContext: TechnicalContext;
  artifacts: ReportArtifact[];
  idempotencyKey: string;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
function imageFromDataUrl(dataUrl: string): { contentType: string; data: Uint8Array } | null {
  const match =
    /^data:(image\/[a-z0-9.+-]+)(?:;[a-z0-9-]+=[^;,]*)*;base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    return {
      contentType: match[1].toLowerCase(),
      data: Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    };
  } catch {
    return null;
  }
}

/** Derives the connector command and selected evidence files from a decoded envelope. */
export function mapReportToIssue(command: InternalIntegrationCommand): ConnectorCommand {
  const { report } = command;
  const artifacts: ReportArtifact[] = [];
  if (command.options.includeHar)
    artifacts.push({
      filename: 'network.har',
      contentType: 'application/x-http-archive',
      data: textBytes(
        JSON.stringify({
          log: {
            version: '1.2',
            creator: { name: 'Fairlead Bridge' },
            entries: report.httpRequests,
          },
        }),
      ),
    });
  if (command.options.includeScreenshots)
    report.screenshots.forEach((screenshot, index) => {
      const image = imageFromDataUrl(screenshot.dataUrl);
      const extension = image ? IMAGE_EXTENSIONS[image.contentType] : undefined;
      if (!image || !extension) return;
      // The id is caller-controlled and reaches provider paths; keep it to a safe alphabet.
      const id = screenshot.id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
      artifacts.push({
        filename: `screenshot-${index + 1}-${id}.${extension}`,
        contentType: image.contentType,
        data: image.data,
      });
    });
  return {
    protocolVersion: command.protocolVersion,
    intent: command.intent,
    title: command.title,
    description: command.description,
    technicalContext: {
      url: report.meta.url,
      startedAt: report.meta.startedAt,
      stoppedAt: report.meta.stoppedAt,
      userActions: report.summary.userActions,
      networkRequests: report.summary.networkRequests,
      errors: report.summary.errors,
    },
    artifacts,
    idempotencyKey: command.idempotencyKey,
  };
}
