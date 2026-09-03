'use client';

import { Dropdown, Link } from '@heroui/react';
import { getInitials } from '@/lib/format';
import { touchTarget } from '@/lib/touchTarget';
import { EllipsisIcon } from '@/components/icons';

interface SidebarUserProfileProps {
  email: string;
  name?: string | null;
  onSignOut: () => void;
}

/**
 * The sidebar/drawer footer's account row: initials, name/email (same data `AppHeader`
 * shows today, via `useAuthenticatedUserContext()`/`useProfileQuery()`), linking to
 * `/profile` — and an overflow menu whose only item is signing out. The design draws this
 * row with just a "..." affordance and no visible "Sign out" control; since signing out is
 * existing functionality that has to stay reachable, its trigger moved here rather than
 * being dropped.
 */
export function SidebarUserProfile({
  email,
  name = null,
  onSignOut,
}: SidebarUserProfileProps) {
  const label = name?.trim() || email;

  return (
    <div className="flex items-center gap-2.5">
      <Link
        className="flex min-w-0 flex-1 items-center gap-2.5"
        href="/profile"
      >
        <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-nav-accent-soft">
          <span className="font-head text-sm font-semibold text-nav-accent">
            {getInitials(name, email)}
          </span>
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[13px] font-semibold text-white">
            {label}
          </span>
          <span className="truncate text-[11px] text-nav-muted">{email}</span>
        </span>
      </Link>

      <Dropdown>
        <Dropdown.Trigger
          aria-label="Account menu"
          className={touchTarget({
            className: 'shrink-0 text-nav-muted',
            fit: 'square',
          })}
        >
          <EllipsisIcon className="size-[17px]" />
        </Dropdown.Trigger>
        <Dropdown.Popover placement="top end">
          <Dropdown.Menu>
            <Dropdown.Item id="sign-out" onAction={onSignOut}>
              Sign out
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
}
