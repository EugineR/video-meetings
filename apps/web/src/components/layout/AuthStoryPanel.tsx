import { CalendarIcon, VideoCameraIcon } from '@/components/icons';

/**
 * The marketing pane on the sign-in/registration screens: brand mark, a static
 * "come back to your meetings" pitch and a purely decorative recent-meeting preview.
 * Always dark, regardless of the app's own light/dark theme — `data-theme="dark"`
 * activates the dark token set locally so the preview card can reuse the same
 * `bg-surface`/`bg-avatar-*`/`bg-accent-soft` tokens the real UI renders with in
 * dark mode, rather than duplicating their color values here.
 *
 * Hidden below `lg`: it is pure decoration, and the two-column layout has no room
 * for it on a narrow viewport.
 */
export function AuthStoryPanel() {
  return (
    <div
      className="hidden w-[590px] shrink-0 flex-col justify-between bg-[#0a0c10] px-[54px] py-[42px] lg:flex"
      data-theme="dark"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <VideoCameraIcon aria-hidden="true" className="size-4" />
        </span>
        <span className="font-head text-xl font-semibold text-foreground">
          Video Meetings
        </span>
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2.5">
          <p className="font-mono text-10 font-semibold tracking-[0.11em] text-accent uppercase">
            Your day, already organized
          </p>
          <h2 className="font-head text-43 leading-[1.05] font-semibold text-foreground">
            Come back to the work that matters.
          </h2>
          <p className="text-sm leading-[1.45] text-muted">
            Your latest decisions, recordings and follow-ups are waiting in one
            place.
          </p>
        </div>

        <div
          aria-hidden="true"
          className="flex flex-col justify-between gap-4 rounded-[10px] border border-border bg-surface p-[18px]"
        >
          <div className="flex flex-col gap-2">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-success-soft px-2 py-1">
              <span className="size-1.5 rounded-full bg-success" />
              <span className="text-xs font-semibold text-success">
                Summary ready
              </span>
            </span>
            <p className="font-head text-lg font-semibold text-foreground">
              Budget planning
            </p>
            <p className="text-xs text-muted">
              Q4 budget allocation and department forecasts
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <CalendarIcon className="size-3.5" />
              <span>Sep 16 · 2:18 PM</span>
              <span>·</span>
              <span>3 files</span>
            </div>

            <div className="flex items-center">
              <div className="flex -space-x-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-avatar-warm text-[9px] font-semibold text-avatar-warm-foreground ring-2 ring-surface">
                  A
                </span>
                <span className="flex size-6 items-center justify-center rounded-full bg-avatar-cool text-[9px] font-semibold text-avatar-cool-foreground ring-2 ring-surface">
                  B
                </span>
              </div>
              <span className="ms-3 rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-semibold text-accent">
                Open summary
              </span>
            </div>
          </div>
        </div>
      </div>

      <p className="font-mono text-9 font-semibold tracking-[0.08em] text-muted-strong uppercase">
        Private by default · Your meetings stay yours
      </p>
    </div>
  );
}
