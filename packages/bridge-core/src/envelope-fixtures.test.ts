import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeEnvelope } from './envelope.js';

const contractRoot = join(dirname(fileURLToPath(import.meta.url)), '../contract');

async function requestFixtures(): Promise<{ name: string; value: unknown }[]> {
  const versions = await readdir(contractRoot, { withFileTypes: true });
  const fixtures = await Promise.all(
    versions
      .filter((entry) => entry.isDirectory())
      .map(async (version) => {
        const directory = join(contractRoot, version.name);
        const entries = await readdir(directory);
        return Promise.all(
          entries
            .filter((name) => /^request-.*\.json$/.test(name))
            .map(async (name) => ({
              name: `${version.name}/${name}`,
              value: JSON.parse(await readFile(join(directory, name), 'utf8')) as unknown,
            })),
        );
      }),
  );
  return fixtures.flat();
}

describe('frozen envelope request fixtures', () => {
  it('replays every stored wire-version fixture through the current decoder', async () => {
    const fixtures = await requestFixtures();
    expect(fixtures).not.toHaveLength(0);
    for (const fixture of fixtures)
      expect(decodeEnvelope(fixture.value), fixture.name).toMatchObject({ ok: true });
  });
});
