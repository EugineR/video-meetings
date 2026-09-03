'use client';

export function UserIcon(props: React.SVGProps<SVGSVGElement>) {
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
      <path d="M17.982 18.725a7.488 7.488 0 0 0-11.963 0M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}
