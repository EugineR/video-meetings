'use client';

/**
 * The sidebar/drawer's storage-usage card — markup only, per the design's mockup for a
 * feature this app doesn't have (there is no per-user storage quota to report). Fully
 * static: no props, no data source. Meant to be feature-flagged once storage tracking
 * exists.
 */
export function SidebarStorageUsage() {
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] bg-nav-surface p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-white">Storage</span>
        <span className="font-mono text-[11px] text-nav-muted">1.8 / 5 GB</span>
      </div>
      <div className="h-1 w-full rounded-full bg-nav-line">
        <div className="h-1 w-[36%] rounded-full bg-accent" />
      </div>
    </div>
  );
}
