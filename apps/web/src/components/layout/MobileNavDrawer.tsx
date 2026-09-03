'use client';

import {
  LayoutDashboardIcon,
  ListChecksIcon,
  UsersIcon,
  VideoCameraIcon,
  XMarkIcon,
} from '@/components/icons';
import { touchTarget } from '@/lib/touchTarget';
import { SidebarNavItem } from '@/components/layout/SidebarNavItem';
import { SidebarStorageUsage } from '@/components/layout/SidebarStorageUsage';
import { SidebarUserProfile } from '@/components/layout/SidebarUserProfile';

interface MobileNavDrawerProps {
  email: string;
  isOpen: boolean;
  name?: string | null;
  onOpenChange: (isOpen: boolean) => void;
  onSignOut: () => void;
}

/**
 * The dashboard's mobile nav drawer (`DashboardShell`, below `lg` only — `AppSidebar` is its
 * desktop equivalent, and this shares its nav list, storage card and profile row). Real
 * open/close: the backdrop and the X both close it, matching the design's "Mobile menu open"
 * frame. Content is otherwise the same "markup only" nav as `AppSidebar` — see there.
 */
export function MobileNavDrawer({
  email,
  isOpen,
  name = null,
  onOpenChange,
  onSignOut,
}: MobileNavDrawerProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-30 lg:hidden">
      {/* Mouse/touch-only dismiss — decorative, so it isn't a second "Close menu" tab
          stop next to the real one below. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 h-full w-full bg-(--backdrop)"
        onClick={() => onOpenChange(false)}
      />

      <div className="absolute inset-y-0 left-0 flex w-[320px] max-w-[85vw] flex-col justify-between bg-nav px-5 py-6 shadow-[8px_0_24px_0_rgba(0,0,0,0.25)]">
        <div className="flex flex-col gap-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex size-[34px] items-center justify-center rounded-[9px] bg-accent">
                <VideoCameraIcon
                  aria-hidden="true"
                  className="size-[17px] text-white"
                />
              </span>
              <span className="font-head text-xl font-semibold text-white">
                meetwise
              </span>
            </div>
            <button
              aria-label="Close menu"
              className={touchTarget({
                className:
                  'cursor-pointer rounded-lg bg-white/[0.07] text-white',
                fit: 'square',
              })}
              onClick={() => onOpenChange(false)}
              type="button"
            >
              <XMarkIcon aria-hidden="true" className="mx-auto size-5" />
            </button>
          </div>

          <nav className="flex flex-col gap-[7px]">
            <SidebarNavItem
              height={48}
              icon={LayoutDashboardIcon}
              label="Overview"
            />
            <SidebarNavItem
              height={48}
              icon={VideoCameraIcon}
              isActive
              label="Meetings"
            />
            <SidebarNavItem height={48} icon={ListChecksIcon} label="Tasks" />
            <SidebarNavItem height={48} icon={UsersIcon} label="People" />
          </nav>
        </div>

        <div className="flex flex-col gap-4">
          <SidebarStorageUsage />
          <SidebarUserProfile email={email} name={name} onSignOut={onSignOut} />
        </div>
      </div>
    </div>
  );
}
