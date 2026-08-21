/**
 * The aidep mark: a sun on a horizon rule. "Sunset" is the industry word for
 * retiring an API, and the sun's height encodes status.
 *
 *   clean   full disc, clear of the horizon
 *   dying   half disc, setting. The identity; the wordmark and favicon use it.
 *   dead    a sliver, almost gone
 *
 * Geometry is the 256-unit artboard from the logo system. Each variant's
 * viewBox ends at the bottom of the horizon rule (y=158), so the rule is the
 * bottom edge of the box and sits on the baseline when the box is inline.
 * Everything is currentColor so it takes the ink of wherever it sits; no
 * gradients, no radius, no stroke.
 */

type Variant = "clean" | "dying" | "dead";

const CY = { clean: 88, dying: 152, dead: 196 } satisfies Record<Variant, number>;
/* top of the visible disc, which is the top of the viewBox */
const TOP = { clean: 24, dying: 88, dead: 132 } satisfies Record<Variant, number>;

export function Mark({
  variant = "dying",
  className = "mark",
  title = "aidep",
}: {
  variant?: Variant;
  className?: string;
  title?: string;
}) {
  const clip = `mark-clip-${variant}`;
  const needsClip = variant !== "clean";
  return (
    <svg
      viewBox={`0 ${TOP[variant]} 256 ${158 - TOP[variant]}`}
      className={className}
      role="img"
      aria-label={title}
    >
      {needsClip && (
        <defs>
          <clipPath id={clip}>
            <rect x="0" y="0" width="256" height="152" />
          </clipPath>
        </defs>
      )}
      <circle
        cx="128"
        cy={CY[variant]}
        r="64"
        fill="currentColor"
        clipPath={needsClip ? `url(#${clip})` : undefined}
      />
      <rect x="16" y="146" width="224" height="12" fill="currentColor" />
    </svg>
  );
}

/**
 * The lockup: the dying mark at 1ex, so the horizon is the baseline and the
 * sun's top is the x-height, then the name in mono. The only way the mark and
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
