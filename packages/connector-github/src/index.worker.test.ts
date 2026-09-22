import { describe, expect, it, vi } from 'vitest';
import { GithubConnector } from './index.js';

describe('GithubConnector in the Workers runtime', () => {
  it('invokes the platform fetch with globalThis as its receiver', async () => {
    const nativeFetch = function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(Response.json({}));
    } as typeof fetch;
    vi.stubGlobal('fetch', nativeFetch);

    try {
      const connector = new GithubConnector({ owner: 'acme', repo: 'repo', token: 'token' });
      await expect(connector.checkCredential()).resolves.toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
