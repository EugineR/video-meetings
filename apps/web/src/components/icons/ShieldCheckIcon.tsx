'use client';

export function ShieldCheckIcon(props: React.SVGProps<SVGSVGElement>) {
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
      <path d="M12 3 5 6v5c0 4.5 3 8.5 7 9.5 4-1 7-5 7-9.5V6l-7-3Z" />
      <path d="M9 12.25 11.25 14.5 15.5 10" />
    </svg>
  );
}
