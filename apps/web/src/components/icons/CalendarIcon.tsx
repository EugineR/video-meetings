'use client';

export function CalendarIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
      {...props}
    >
      <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
      <path d="M16 3v3M8 3v3M3 9.75h18" />
    </svg>
  );
}
