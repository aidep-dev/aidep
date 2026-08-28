/** Whole days from now (as a UTC calendar date) until a YYYY-MM-DD dies date.
 * 0 means it dies today; negative means it is already dead. */
export function daysUntil(dies: string, now: Date): number {
  const [y, m, d] = dies.split("-").map(Number);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.UTC(y, m - 1, d) - today) / 86_400_000);
}

/** Chip text. Status is never color alone; this label always rides the chip. */
export function daysLabel(days: number): string {
  if (days <= 0) return "calls fail today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export function chipClass(days: number | null, retired: boolean): string {
  if (retired) return "bg-dead-bg text-dead";
  if (days !== null && days <= 90) return "bg-dying-bg text-dying";
  return "border border-rule text-ink-secondary";
}

/**
 * Status text. A passed date is not the same as a dead model: Google publishes
 * "earliest possible" shutdown dates, so a row whose date has gone by may
 * still answer. Only the provider marking it retired means the calls fail.
 */
export function statusLabel(
  row: { status: string; dies: string | null; dies_is_earliest_possible: boolean },
  days: number | null,
): string {
  if (row.status === "retired") return row.dies ? `retired ${formatDies(row.dies)}` : "retired";
  if (days === null) return "no date announced";
  if (days <= 0) return row.dies_is_earliest_possible ? "past earliest date" : "calls fail today";
  return daysLabel(days);
}

/** "2026-08-26" -> "Aug 26, 2026", locale-pinned so server output is stable. */
export function formatDies(dies: string): string {
  const [y, m, d] = dies.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
