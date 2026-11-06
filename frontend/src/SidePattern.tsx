export function SidePattern({ className = '' }: { className?: string }) {
  return (
    <div className={`side-pattern ${className}`} aria-hidden="true">
      <svg viewBox="0 0 600 1000" preserveAspectRatio="xMidYMid slice" fill="none">
        <path d="M600-160C260-160 0 105 0 500S260 1160 600 1160V-160Z" fill="var(--pink-light)" />
        <path d="M600-160C344-160 64 105 64 500S344 1160 600 1160V-160Z" fill="var(--paper)" />
        <path d="M600-160C410-160 144 105 144 500S410 1160 600 1160V-160Z" fill="var(--pink-light)" />
        <path d="M600-160C488-160 248 105 248 500S488 1160 600 1160V-160Z" fill="var(--paper)" />
        <path d="M600-160C566-160 368 105 368 500S566 1160 600 1160V-160Z" fill="var(--pink-light)" />
      </svg>
    </div>
  );
}
