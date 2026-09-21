import type { InternalIntegrationCommand } from './envelope.js';
import type { BridgeReport } from './report.js';

export interface ReportArtifact {
  filename: string;
  contentType: string;
  data: Uint8Array;
}
export interface MappedIntegrationCommand extends Omit<InternalIntegrationCommand, 'report'> {
  report: BridgeReport;
  renderedDescription: string;
  artifacts: ReportArtifact[];
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
function dataUrlBytes(dataUrl: string): Uint8Array | null {
  const match = /^data:[^;,]+;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const binary = atob(match[1]);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Renders the provider-neutral Fairlead block and materializes selected evidence. */
export function mapReportToIssue(
  command: InternalIntegrationCommand,
  report: BridgeReport,
): MappedIntegrationCommand {
  const renderedDescription = `${command.description}\n\n---\n\n## Fairlead technical context\n\n- URL: ${report.meta.url}\n- Recorded: ${report.meta.startedAt} – ${report.meta.stoppedAt}\n- User actions: ${report.summary.userActions}\n- Network requests: ${report.summary.networkRequests}\n- Errors: ${report.summary.errors}`;
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
    for (const screenshot of report.screenshots) {
      const data = dataUrlBytes(screenshot.dataUrl);
      if (data)
        artifacts.push({
          filename: `screenshot-${screenshot.id}.png`,
          contentType: 'image/png',
          data,
        });
    }
  return { ...command, report, renderedDescription, artifacts };
}
