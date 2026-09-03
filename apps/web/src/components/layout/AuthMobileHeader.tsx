import { ShieldCheckIcon, VideoCameraIcon } from '@/components/icons';

/**
 * `AuthStoryPanel`'s mobile counterpart: below `lg` there's no room for the side panel,
 * so this compact dark bar sits above the form instead. Always dark, like the panel it
 * replaces — see `AuthStoryPanel` for why `data-theme="dark"` is scoped locally rather
 * than following the app's own theme.
 */
export function AuthMobileHeader() {
  return (
    <div
      className="flex w-full flex-col gap-3.5 bg-[#0a0c10] px-5 py-[18px] lg:hidden"
      data-theme="dark"
    >
      <div className="flex items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <VideoCameraIcon aria-hidden="true" className="size-3.5" />
        </span>
        <span className="font-head text-lg font-semibold text-foreground">
          Video Meetings
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className="font-mono text-8 font-semibold tracking-[0.09em] text-muted-strong uppercase">
          Meetings, made useful
        </span>
        <ShieldCheckIcon aria-hidden="true" className="size-3.5 text-accent" />
      </div>
    </div>
  );
}
