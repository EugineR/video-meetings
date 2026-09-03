'use client';

export function EllipsisIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg fill="currentColor" stroke="none" viewBox="0 0 24 24" {...props}>
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  );
}
