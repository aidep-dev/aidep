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
