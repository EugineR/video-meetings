'use client';

import type { ComponentType, ReactNode } from 'react';
import { Link } from '@heroui/react';

interface SidebarNavItemProps {
  height?: 44 | 48;
  icon: ComponentType<{ className?: string }>;
  isActive?: boolean;
  label: ReactNode;
}

/**
 * One row of `AppSidebar`'s and `MobileNavDrawer`'s nav list: an icon and a label, tinted
 * for the active route. Only "Meetings" (the current, and only, dashboard route) is ever
 * active or a real link — "Overview", "Tasks" and "People" render the same row shape with no
 * `href`, matching the design's mockup for pages this app doesn't have yet.
 */
export function SidebarNavItem({
  height = 44,
  icon: Icon,
  isActive = false,
  label,
}: SidebarNavItemProps) {
  const content = (
    <>
      <Icon
        className={
          isActive ? 'size-[18px] text-white' : 'size-[18px] text-nav-muted'
        }
      />
      <span
        className={
          isActive
            ? 'text-sm font-semibold text-white'
            : 'text-sm font-[450] text-nav-muted-strong'
        }
      >
        {label}
      </span>
    </>
  );

  const className = `flex w-full items-center gap-3 rounded-lg px-3 ${
    isActive ? 'bg-white/[0.08]' : ''
  }`;

  return isActive ? (
    <Link className={className} href="/" style={{ height }}>
      {content}
    </Link>
  ) : (
    <div aria-disabled="true" className={className} style={{ height }}>
      {content}
    </div>
  );
}
