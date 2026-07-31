/**
 * What one seed step did — sprint-03 EVT-017.
 *
 * ## Why the counters exist at all
 *
 * The ticket's acceptance test is "running `db:seed` twice produces exactly
 * the same state". A step that silently succeeds proves nothing about that: a
 * blind `upsert` on every row also succeeds twice, and also reports success,
 * while rewriting every `updated_at` in the table. The counters make the
 * second run *observably* a no-op — `created` and `updated` both zero — which
 * is a claim a CI step can assert on rather than a claim a person has to
 * take on trust.
 */
export interface SeedOutcome {
  readonly step: string;
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  /** Rows deliberately removed. Only `role_permissions` ever removes any. */
  readonly removed: number;
  /** Anything a human should read, e.g. a catalogue entry now orphaned. */
  readonly notes: readonly string[];
}

export function outcome(
  step: string,
  counts: Partial<Omit<SeedOutcome, 'step' | 'notes'>> & {
    notes?: readonly string[];
  },
): SeedOutcome {
  return {
    step,
    created: counts.created ?? 0,
    updated: counts.updated ?? 0,
    unchanged: counts.unchanged ?? 0,
    removed: counts.removed ?? 0,
    notes: counts.notes ?? [],
  };
}

/** Whether a run changed anything at all — the idempotency assertion. */
export function isNoOp(outcomes: readonly SeedOutcome[]): boolean {
  return outcomes.every(
    (entry) =>
      entry.created === 0 && entry.updated === 0 && entry.removed === 0,
  );
}

const COLUMNS = ['created', 'updated', 'unchanged', 'removed'] as const;

export function formatOutcomes(outcomes: readonly SeedOutcome[]): string {
  const stepWidth = Math.max(4, ...outcomes.map((entry) => entry.step.length));

  const header = [
    'step'.padEnd(stepWidth),
    ...COLUMNS.map((column) => column.padStart(9)),
  ].join('  ');

  const rows = outcomes.map((entry) =>
    [
      entry.step.padEnd(stepWidth),
      ...COLUMNS.map((column) => String(entry[column]).padStart(9)),
    ].join('  '),
  );

  return [header, '-'.repeat(header.length), ...rows].join('\n');
}
