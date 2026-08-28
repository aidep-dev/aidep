/**
 * The aidep mark: a block losing cells. The square is the model; the bites
 * are the deprecations. Replaces the sunset (2026-08-27): "sunsetting" is the
 * industry word but a generic visual, and a block with pieces going dead is
 * the literal product.
 *
 *   clean   the block intact
 *   dying   a three-cell bite eaten from the top-right corner. The identity;
 *           the wordmark and favicon use it.
 *   dead    the bottom-left L the bite left behind
 *
 * A 4x4 grid, because 16 divides by 4: a favicon renders crisp 4px cells.
 * Decay is monotonic (every dead cell was already dead in dying) and lives on
 * the outer silhouette, so it survives small sizes. Every state keeps a full
 * bottom row, so the bottom edge of the viewBox is the baseline wherever the
 * mark sits inline. One path per state, currentColor, no stroke, no radius.
 */

type Variant = "clean" | "dying" | "dead";

const PATH = {
  clean: "M0 0H4V4H0Z",
  dying: "M0 0H2V1H3V2H4V4H0Z",
  dead: "M0 0H1V3H4V4H0Z",
} satisfies Record<Variant, string>;

export function Mark({
  variant = "dying",
  className = "mark",
  title = "aidep",
}: {
  variant?: Variant;
  className?: string;
  title?: string;
}) {
  return (
    <svg viewBox="0 0 4 4" className={className} role="img" aria-label={title}>
      <path d={PATH[variant]} fill="currentColor" />
    </svg>
  );
}

/**
 * The lockup: the dying mark at 1ex, so the block sits on the baseline and
 * its top is the x-height, then the name in mono. The only way the mark and
 * the name appear together. Size it with text-* on the parent.
 */
export function Wordmark() {
  return (
    <span className="inline-flex items-baseline gap-2 font-mono leading-none tracking-tight">
      <Mark />
      aidep
    </span>
  );
}
