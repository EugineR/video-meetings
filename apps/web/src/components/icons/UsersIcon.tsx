'use client';

export function UsersIcon(props: React.SVGProps<SVGSVGElement>) {
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
      <circle cx="9" cy="7.5" r="3" />
      <path d="M2.25 20.25a6.75 6.75 0 0 1 13.5 0" />
      <path d="M15.5 5.05a3 3 0 0 1 0 5.9M18.25 20.25a6.75 6.75 0 0 0-3.4-5.86" />
    </svg>
  );
}
