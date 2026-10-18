/** Brand mark: a film frame with a play cursor, plus the wordmark. */
export default function Logo() {
  return (
    <span className="logo">
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
        <rect x="2" y="6" width="28" height="20" rx="5" fill="var(--accent)" />
        <path d="M13 11.5v9l8-4.5-8-4.5Z" fill="#fff" />
        <circle cx="7" cy="10" r="1.2" fill="#fff" opacity=".7" />
        <circle cx="7" cy="22" r="1.2" fill="#fff" opacity=".7" />
        <circle cx="25" cy="10" r="1.2" fill="#fff" opacity=".7" />
        <circle cx="25" cy="22" r="1.2" fill="#fff" opacity=".7" />
      </svg>
      <span>AI Movie <b>Director</b></span>
    </span>
  );
}
