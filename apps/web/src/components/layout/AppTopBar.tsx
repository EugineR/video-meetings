'use client';

import { BellIcon, SearchIcon } from '@/components/icons';

/**
 * The dashboard's desktop top bar (`DashboardShell`, `lg:` and up — `MobileTopBar` is its
 * mobile equivalent). Page title and breadcrumb are static text: this shell only ever
 * renders on `/`, the one dashboard route today. The search field and notification bell
 * match the design's mockup — there is no search or notifications feature to wire up yet,
 * so both are markup only.
 */
export function AppTopBar() {
  return (
    <header className="flex h-[78px] shrink-0 items-center justify-between border-b border-border bg-surface px-[42px]">
      <div className="flex flex-col gap-0.5">
        <h1 className="font-head text-xl font-semibold text-foreground">
          Meetings
        </h1>
        <p className="text-xs text-muted">Workspace / Meetings</p>
      </div>

      <div className="flex items-center gap-2.5">
        <div className="flex h-10 w-[228px] items-center gap-2.5 rounded-lg border border-border bg-subtle px-[13px]">
          <SearchIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-muted"
          />
          <span className="truncate text-[13px] text-(--field-placeholder)">
            Search meetings…
          </span>
        </div>
        <BellIcon
          aria-hidden="true"
          className="size-[19px] shrink-0 text-foreground"
        />
      </div>
    </header>
  );
}
