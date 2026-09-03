'use client';

export function BellIcon(props: React.SVGProps<SVGSVGElement>) {
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
      <path d="M5.25 9.75a6.75 6.75 0 1 1 13.5 0c0 4.06 1 5.85 1.6 6.6a.75.75 0 0 1-.6 1.2H4.25a.75.75 0 0 1-.6-1.2c.6-.75 1.6-2.54 1.6-6.6Z" />
      <path d="M9.75 20.25a2.25 2.25 0 0 0 4.5 0" />
    </svg>
  );
}
