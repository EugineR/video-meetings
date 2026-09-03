'use client';

export function EnvelopeIcon(props: React.SVGProps<SVGSVGElement>) {
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
      <rect x="2.25" y="5.25" width="19.5" height="13.5" rx="2.25" />
      <path d="m3 7 9 6.25L21 7" />
    </svg>
  );
}
