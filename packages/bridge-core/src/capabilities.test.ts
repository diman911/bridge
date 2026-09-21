import { describe, expect, it } from 'vitest';
import { COMMAND_OPERATION, supportsCommand, supportsRead } from './capabilities.js';

describe('capabilities', () => {
  it('checks the (target, action) pair, not the action name alone', () => {
    expect(supportsCommand({ issue: { actions: ['create'], reads: [] } }, 'create_issue')).toBe(
      true,
    );
    expect(supportsCommand({ issue: { actions: ['create'], reads: [] } }, 'update_issue')).toBe(
      false,
    );
    // Same action name on a different target must not grant the issue command.
    expect(supportsCommand({ test_run: { actions: ['create'], reads: [] } }, 'create_issue')).toBe(
      false,
    );
    expect(supportsCommand({}, 'create_issue')).toBe(false);
  });

  it('answers reads per declared kind', () => {
    const targets = { issue: { actions: [], reads: ['fetch' as const] } };
    expect(supportsRead(targets, 'fetch')).toBe(true);
    expect(supportsRead(targets, 'search')).toBe(false);
  });

  it('maps every wire command to a capability operation', () => {
    expect(COMMAND_OPERATION.create_issue).toEqual({ target: 'issue', action: 'create' });
    expect(COMMAND_OPERATION.update_issue).toEqual({ target: 'issue', action: 'update' });
  });
});
