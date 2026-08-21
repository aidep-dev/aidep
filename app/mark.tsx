/**
 * The aidep mark: a setting sun on a horizon rule. "Sunset" is the industry
 * word for retiring an API, and the sun's height encodes status.
 *
 *   clean   full disc, clear of the horizon
 *   dying   half disc, setting (the default, and the wordmark's)
 *   dead    a sliver, almost gone
 *
 * Geometry is the 256-unit artboard from the logo system. Everything is
 * currentColor so it takes the ink of wherever it sits; no gradients, no
 * radius, no stroke.
 */

type Variant = "clean" | "dying" | "dead";

const CY = { clean: 88, dying: 152, dead: 196 } satisfies Record<Variant, number>;

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
    <svg viewBox="0 0 256 256" className={className} role="img" aria-label={title}>
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
