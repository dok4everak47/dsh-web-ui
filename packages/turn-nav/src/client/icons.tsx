/** Inline SVG icons for the turn-nav plugin (14px, currentColor, like primitives). */

/** List-with-lines glyph: conversation turns / outline navigation. */
export function TurnNavIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="2.5" height="2.5" rx="0.75" fill="currentColor" />
      <path d="M6 3.75h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <rect x="1.5" y="8.5" width="2.5" height="2.5" rx="0.75" fill="currentColor" />
      <path d="M6 9.75h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <rect x="1.5" y="12.5" width="2.5" height="1.5" rx="0.75" fill="currentColor" opacity="0.5" />
      <path d="M6 13.25h5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.5" />
    </svg>
  )
}
