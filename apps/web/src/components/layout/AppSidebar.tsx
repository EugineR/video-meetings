'use client';

import { Link } from '@heroui/react';
import {
  LayoutDashboardIcon,
  ListChecksIcon,
  UsersIcon,
  VideoCameraIcon,
} from '@/components/icons';
import { SidebarNavItem } from '@/components/layout/SidebarNavItem';
import { SidebarStorageUsage } from '@/components/layout/SidebarStorageUsage';
import { SidebarUserProfile } from '@/components/layout/SidebarUserProfile';

interface AppSidebarProps {
  email: string;
  name?: string | null;
  onSignOut: () => void;
}

/**
 * The dashboard's desktop nav rail (`DashboardShell`, `lg:` and up only — `MobileNavDrawer`
 * is its mobile equivalent). Only "Meetings" is a real, active link: "Overview", "Tasks" and
 * "People" match the design's mockup for pages this app doesn't have yet, so they render
 * inert (see `SidebarNavItem`).
 */
export function AppSidebar({ email, name = null, onSignOut }: AppSidebarProps) {
  return (
    <aside className="flex w-[244px] shrink-0 flex-col justify-between bg-nav px-[22px] py-7">
      <div className="flex flex-col gap-[34px]">
        <Link className="flex items-center gap-[11px]" href="/">
          <span className="flex size-[34px] items-center justify-center rounded-[9px] bg-accent">
            <VideoCameraIcon
              aria-hidden="true"
              className="size-[18px] text-white"
            />
          </span>
          <span className="font-head text-xl font-semibold text-white">
            meetwise
          </span>
        </Link>

        <nav className="flex flex-col gap-[7px]">
          <SidebarNavItem icon={LayoutDashboardIcon} label="Overview" />
          <SidebarNavItem icon={VideoCameraIcon} isActive label="Meetings" />
          <SidebarNavItem icon={ListChecksIcon} label="Tasks" />
          <SidebarNavItem icon={UsersIcon} label="People" />
        </nav>
      </div>

      <div className="flex flex-col gap-3.5">
        <SidebarStorageUsage />
        <SidebarUserProfile email={email} name={name} onSignOut={onSignOut} />
      </div>
    </aside>
  );
}
