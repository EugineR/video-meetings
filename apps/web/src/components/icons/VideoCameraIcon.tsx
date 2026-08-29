'use client';

export function VideoCameraIcon(props: React.SVGProps<SVGSVGElement>) {
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
      <rect x="2.25" y="6.75" width="12" height="10.5" rx="2" />
      <path d="M14.25 10.5l6.4-3.66a.75.75 0 0 1 1.1.66v8.5a.75.75 0 0 1-1.1.66l-6.4-3.66" />
    </svg>
  );
}
