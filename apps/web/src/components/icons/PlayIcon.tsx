'use client';

export function PlayIcon(props: React.SVGProps<SVGSVGElement>) {
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
      <path d="M6.75 5.25v13.5a.75.75 0 0 0 1.14.64l10.5-6.75a.75.75 0 0 0 0-1.28L7.89 4.61a.75.75 0 0 0-1.14.64Z" />
    </svg>
  );
}
