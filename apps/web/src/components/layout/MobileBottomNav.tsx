'use client';

import type { ComponentType } from 'react';
import { Link } from '@heroui/react';
import {
  LayoutDashboardIcon,
  ListChecksIcon,
  UsersIcon,
  VideoCameraIcon,
} from '@/components/icons';

interface BottomNavItemProps {
  icon: ComponentType<{ className?: string }>;
  isActive?: boolean;
  label: string;
}

function BottomNavItem({
  icon: Icon,
  isActive = false,
  label,
}: BottomNavItemProps) {
  const content = (
    <>
      <span
        className={`flex h-7 w-8 items-center justify-center rounded-[9px] ${
          isActive ? 'bg-accent-soft' : ''
        }`}
      >
        <Icon
          className={`size-[19px] ${isActive ? 'text-accent' : 'text-muted'}`}
        />
      </span>
      <span
        className={`text-[10px] ${
          isActive ? 'font-semibold text-accent' : 'font-medium text-muted'
        }`}
      >
        {label}
      </span>
    </>
  );

  return isActive ? (
    <Link
      className="flex h-full flex-1 flex-col items-center justify-center gap-0.5"
      href="/"
    >
      {content}
    </Link>
  ) : (
    <div
      aria-disabled="true"
      className="flex h-full flex-1 flex-col items-center justify-center gap-0.5"
    >
      {content}
    </div>
  );
}

/**
 * The dashboard's mobile bottom nav (`DashboardShell`, below `lg` only). Mirrors
 * `AppSidebar`'s nav list: only "Meetings" is a real, active link, the rest match the
 * design's mockup for pages this app doesn't have yet.
 */
export function MobileBottomNav() {
  return (
    <nav className="flex h-[76px] shrink-0 items-center gap-1 border-t border-border bg-surface px-3 pt-1.5 pb-2.5 shadow-[0_-6px_18px_0_rgba(17,24,39,0.078)]">
      <BottomNavItem icon={LayoutDashboardIcon} label="Overview" />
      <BottomNavItem icon={VideoCameraIcon} isActive label="Meetings" />
      <BottomNavItem icon={ListChecksIcon} label="Tasks" />
      <BottomNavItem icon={UsersIcon} label="People" />
    </nav>
  );
}
