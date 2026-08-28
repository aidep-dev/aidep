/* The hairline and label that sit above every section head. */
export function Kicker({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`label flex items-center gap-3 text-ink-muted ${className}`}>
      <span className="inline-block h-px w-8 bg-rule-strong" aria-hidden />
      {children}
    </p>
  );
}
