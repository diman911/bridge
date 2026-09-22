import { describe, expect, it, vi } from 'vitest';
import { AzureDevOpsConnector } from './index.js';

describe('AzureDevOpsConnector in the Workers runtime', () => {
  it('invokes the platform fetch with globalThis as its receiver', async () => {
    const nativeFetch = function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(Response.json({ value: [] }));
    } as typeof fetch;
    vi.stubGlobal('fetch', nativeFetch);

    try {
      const connector = new AzureDevOpsConnector({
        organization: 'acme',
        project: 'project',
        token: 'token',
        authType: 'oauth',
      });
      await expect(connector.checkCredential()).resolves.toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
