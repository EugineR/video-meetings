'use client';

export function LockClosedIcon(props: React.SVGProps<SVGSVGElement>) {
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
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2" />
      <path d="M7.5 10.5V7.5a4.5 4.5 0 1 1 9 0v3" />
    </svg>
  );
}
