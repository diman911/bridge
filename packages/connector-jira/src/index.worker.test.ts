import { describe, expect, it, vi } from 'vitest';
import { JiraConnector } from './index.js';

describe('JiraConnector in the Workers runtime', () => {
  it('invokes the platform fetch with globalThis as its receiver', async () => {
    const nativeFetch = function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(Response.json({}));
    } as typeof fetch;
    vi.stubGlobal('fetch', nativeFetch);

    try {
      const connector = new JiraConnector({
        baseUrl: 'https://example.atlassian.net',
        projectKey: 'APP',
        token: 'token',
      });
      await expect(connector.checkCredential()).resolves.toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
