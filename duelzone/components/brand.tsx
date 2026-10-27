export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`dz-identity ${compact ? "compact" : ""}`}>
      <svg
        className="dz-symbol"
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
      >
        <path
          className="dz-left"
          d="M7 7H23L17 14H12V26H7V7Z"
          fill="currentColor"
        />
        <path
          className="dz-right"
          d="M33 33H17L23 26H28V14H33V33Z"
          fill="currentColor"
        />
        <path
          className="dz-cut"
          d="M25 6L12 34H17L30 6H25Z"
          fill="currentColor"
        />
      </svg>
      {!compact && (
        <span>
          duelzone<span className="dz-word-dot">.</span>
        </span>
      )}
    </span>
  );
}
