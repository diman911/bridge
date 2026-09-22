import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectorAttachment, ReadOperation } from '@fairlead/bridge-core';
import { AzureDevOpsConnector } from '../../packages/connector-azure-devops/src/index.js';

const organization = process.env.BRIDGE_E2E_AZURE_DEVOPS_ORGANIZATION;
const project = process.env.BRIDGE_E2E_AZURE_DEVOPS_PROJECT;
const base = `https://dev.azure.com/${encodeURIComponent(organization ?? '')}/${encodeURIComponent(project ?? '')}`;

export interface AzureDevOpsE2eCredential {
  label: string;
  token: string | undefined;
  authType: 'api_token' | 'oauth';
}

export function runAzureDevOpsConnectorIntegrationSuite({
  label,
  token,
  authType,
}: AzureDevOpsE2eCredential): void {
  const enabled = Boolean(organization && project && token);

  function headers(json = false, credential = token): Record<string, string> {
    return {
      Authorization:
        authType === 'api_token'
          ? `Basic ${btoa(`:${credential ?? ''}`)}`
          : `Bearer ${credential ?? ''}`,
      Accept: 'application/json',
      ...(json ? { 'Content-Type': 'application/json-patch+json' } : {}),
    };
  }

  async function adoJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...headers(Boolean(init?.body)), ...init?.headers },
    });
    const body = await response.text();
    if (!response.ok)
      throw new Error(
        `Azure DevOps ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
      );
    return body ? (JSON.parse(body) as T) : (undefined as T);
  }

  const suite = describe.skipIf(!enabled);

  suite(`Azure DevOps connector → real Azure DevOps Services API (${label})`, () => {
    let connector: AzureDevOpsConnector;
    let issueId: string;
    let title: string;
    let attachmentFilename: string;

    beforeAll(async () => {
      connector = new AzureDevOpsConnector({
        organization: organization!,
        project: project!,
        token: token!,
        authType,
      });
      title = `Fairlead connector E2E ${crypto.randomUUID()}`;
      attachmentFilename = `evidence-${crypto.randomUUID()}.txt`;
      const result = await connector.execute(
        {
          protocolVersion: 1,
          type: 'create_issue',
          subject: title,
          description: 'Created by the Azure DevOps connector integration suite.',
        },
        { signal: new AbortController().signal },
      );
      expect(result.ok, JSON.stringify(result)).toBe(true);
      issueId = result.issueId!;
    }, 30_000);

    afterAll(async () => {
      if (!issueId) return;
      await fetch(`${base}/_apis/wit/workitems/${encodeURIComponent(issueId)}?api-version=7.1`, {
        method: 'DELETE',
        headers: headers(),
      });
    }, 30_000);

    it('creates a Bug without setting Area or Iteration paths', async () => {
      const issue = await adoJson<{
        fields: { 'System.WorkItemType': string; 'System.TeamProject': string };
      }>(`/_apis/wit/workitems/${encodeURIComponent(issueId)}?api-version=7.1`);
      expect(issue.fields['System.WorkItemType']).toBe('Bug');
      expect(issue.fields['System.TeamProject']).toBe(project);
    });

    it('checks a valid credential through the profile endpoint', async () => {
      await expect(connector.checkCredential()).resolves.toBe(true);
    });

    it('updates, fetches, and searches the work item', async () => {
      const updatedTitle = `${title} updated`;
      await expect(
        connector.execute(
          {
            protocolVersion: 1,
            type: 'update_issue',
            issueId,
            subject: updatedTitle,
            description: 'Updated by the Azure DevOps connector integration suite.',
          },
          { signal: new AbortController().signal },
        ),
      ).resolves.toMatchObject({ ok: true, issueId });

      await expect(
        connector.read(
          { type: 'fetch', connectorId: 'azure_devops', id: issueId } satisfies ReadOperation,
          { signal: new AbortController().signal },
        ),
      ).resolves.toMatchObject({ ok: true, issue: { id: issueId, title: updatedTitle } });
      const searchResult = await connector.read(
        { type: 'search', connectorId: 'azure_devops', query: title } satisfies ReadOperation,
        { signal: new AbortController().signal },
      );
      expect(searchResult.ok).toBe(true);
      if (searchResult.ok)
        expect(searchResult.issues.some((issue) => issue.id === issueId)).toBe(true);
    });

    it('replaces a native attachment by filename', async () => {
      const attachment = (content: string): ConnectorAttachment => ({
        protocolVersion: 1,
        issueId,
        filename: attachmentFilename,
        contentType: 'text/plain',
        data: new Blob([content]).stream(),
        limitState: { exceeded: false, actualBytes: content.length },
      });
      await expect(
        connector.attach(attachment('first version'), { signal: new AbortController().signal }),
      ).resolves.toEqual({ filename: attachmentFilename, ok: true });
      await expect(
        connector.attach(attachment('replacement version'), {
          signal: new AbortController().signal,
        }),
      ).resolves.toMatchObject({ filename: attachmentFilename, ok: true });

      const issue = await adoJson<{
        relations?: { rel: string; attributes?: { comment?: string } }[];
      }>(`/_apis/wit/workitems/${encodeURIComponent(issueId)}?$expand=relations&api-version=7.1`);
      expect(
        (issue.relations ?? []).filter(
          (relation) =>
            relation.rel === 'AttachedFile' && relation.attributes?.comment === attachmentFilename,
        ),
      ).toHaveLength(1);
    });

    it('returns false for an invalid credential', async () => {
      const invalid = new AzureDevOpsConnector({
        organization: organization!,
        project: project!,
        token: `${token!}-invalid`,
        authType,
      });
      await expect(invalid.checkCredential()).resolves.toBe(false);
    });
  });
}
