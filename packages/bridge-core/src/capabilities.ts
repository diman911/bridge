import type { CommandType } from './envelope-v1.js';
import type { Outcome, ReadOperation, TargetReference } from './types.js';

/** A domain object a connector can act on; `none` (share-only) has no capabilities. */
export type TargetKind = Exclude<TargetReference['kind'], 'none'>;

/**
 * Operations per target, in short domain vocabulary. Deliberately not the
 * wire command names: `COMMAND_OPERATION` maps wire commands onto these, so
 * this model can grow without a wire-protocol change. Targets without wire
 * commands yet are open `string`s; narrow them when their commands land.
 * Adding a union member is a non-breaking manifest change.
 */
export interface TargetActionMap {
  issue: 'create' | 'update';
  test_case: string;
  test_run: string;
  incident: string;
}

export type ReadKind = ReadOperation['type'];

export interface TargetCapabilities<Action extends string = string> {
  /** Mutations (execute path). */
  actions: Action[];
  /** Read-only lookups (read path) — separate from actions: different routes and idempotency. */
  reads: ReadKind[];
  /** Whether evidence can be attached to this target. */
  attachments?: boolean;
  /** Maps a generic Outcome to this target's own status/verdict vocabulary. */
  verdictMappings?: Partial<Record<Outcome, string>>;
}

export type ConnectorTargets = {
  [K in TargetKind]?: TargetCapabilities<TargetActionMap[K]>;
};

export interface CommandOperation {
  target: TargetKind;
  action: string;
}

/** Wire command → capability (target, action). Add one entry per new wire command. */
export const COMMAND_OPERATION: Record<CommandType, CommandOperation> = {
  create_issue: { target: 'issue', action: 'create' },
  update_issue: { target: 'issue', action: 'update' },
};

/** Whether a manifest's `targets` allows the wire command's (target, action) pair. */
export function supportsCommand(targets: ConnectorTargets, type: CommandType): boolean {
  const { target, action } = COMMAND_OPERATION[type];
  const actions: readonly string[] | undefined = targets[target]?.actions;
  return actions?.includes(action) ?? false;
}

/** Whether a manifest's `targets` declares a read on any target. */
export function supportsRead(targets: ConnectorTargets, kind: ReadKind): boolean {
  return Object.values(targets).some((t) => t?.reads.includes(kind));
}
