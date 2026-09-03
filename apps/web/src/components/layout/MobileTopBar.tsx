'use client';

import { BellIcon, MenuIcon, VideoCameraIcon } from '@/components/icons';
import { touchTarget } from '@/lib/touchTarget';

interface MobileTopBarProps {
  onOpenMenu: () => void;
}

/**
 * The dashboard's mobile top bar (`DashboardShell`, below `lg` — `AppTopBar` is its desktop
 * equivalent). The notification bell matches the design's mockup with no notifications
 * feature behind it (markup only); the menu button is real — it opens `MobileNavDrawer`.
 */
export function MobileTopBar({ onOpenMenu }: MobileTopBarProps) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface px-5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-[30px] items-center justify-center rounded-lg bg-accent">
          <VideoCameraIcon
            aria-hidden="true"
            className="size-[15px] text-white"
          />
        </span>
        <span className="font-head text-lg font-semibold text-foreground">
          meetwise
        </span>
      </div>

      <div className="flex items-center gap-2.5">
        <BellIcon aria-hidden="true" className="size-[19px] text-foreground" />
        <button
          aria-label="Open menu"
          className={touchTarget({
            className: 'cursor-pointer text-foreground',
            fit: 'square',
          })}
          onClick={onOpenMenu}
          type="button"
        >
          <MenuIcon aria-hidden="true" className="size-[22px]" />
        </button>
      </div>
    </header>
  );
}
