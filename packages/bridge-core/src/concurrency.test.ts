import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency.js';

describe('mapWithConcurrency', () => {
  it('keeps input order and never exceeds the limit', async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 5 - n));
      active--;
      return n * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });
  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 3, async (n) => n)).toEqual([]);
  });
});
