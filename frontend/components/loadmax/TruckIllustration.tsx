/** Uproszczony widok z góry ciągnika siodłowego z naczepą (inline SVG). */
export function TruckIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 110"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Widok z góry ciągnika siodłowego z naczepą"
    >
      {/* korpus naczepy */}
      <rect
        x="96"
        y="14"
        width="214"
        height="82"
        rx="8"
        fill="#f1f2f5"
        stroke="#d1d5db"
        strokeWidth="1.5"
      />
      <line x1="120" y1="14" x2="120" y2="96" stroke="#e2e4ea" strokeWidth="1.5" />
      <line x1="300" y1="22" x2="300" y2="88" stroke="#e2e4ea" strokeWidth="1.5" />

      {/* dach kabiny */}
      <rect
        x="14"
        y="22"
        width="78"
        height="66"
        rx="12"
        fill="#ffffff"
        stroke="#c7cad3"
        strokeWidth="1.5"
      />
      {/* szyba */}
      <path d="M18 34 Q16 55 18 76 L40 70 L40 40 Z" fill="#2b2f3a" opacity="0.9" />
      {/* lusterka */}
      <rect x="40" y="14" width="10" height="6" rx="2" fill="#9ca3af" />
      <rect x="40" y="90" width="10" height="6" rx="2" fill="#9ca3af" />
      {/* detal kabiny */}
      <rect x="52" y="40" width="34" height="30" rx="6" fill="#eef0f4" />
      <rect x="62" y="50" width="14" height="10" rx="3" fill="#cbd0da" />
    </svg>
  );
}
