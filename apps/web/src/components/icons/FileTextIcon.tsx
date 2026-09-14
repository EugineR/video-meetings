'use client';

export function FileTextIcon(props: React.SVGProps<SVGSVGElement>) {
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
      <path d="M13.5 3H7.125A1.125 1.125 0 0 0 6 4.125v15.75A1.125 1.125 0 0 0 7.125 21h9.75A1.125 1.125 0 0 0 18 19.875V7.5L13.5 3Z" />
      <path d="M13.5 3v3.375c0 .621.504 1.125 1.125 1.125H18M9 12.75h6M9 16.5h6" />
    </svg>
  );
}
