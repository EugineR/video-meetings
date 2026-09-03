'use client';

export function SearchIcon(props: React.SVGProps<SVGSVGElement>) {
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
      <circle cx="10.5" cy="10.5" r="6.75" />
      <path d="m20.25 20.25-4.85-4.85" />
    </svg>
  );
}
