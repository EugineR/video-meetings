'use client';

export function ListChecksIcon(props: React.SVGProps<SVGSVGElement>) {
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
      <path d="M3.75 5.25 5.25 6.75 8.25 3.75" />
      <path d="M3.75 12 5.25 13.5 8.25 10.5" />
      <path d="M3.75 18.75 5.25 20.25 8.25 17.25" />
      <path d="M11.25 5.25h9M11.25 12h9M11.25 18.75h9" />
    </svg>
  );
}
