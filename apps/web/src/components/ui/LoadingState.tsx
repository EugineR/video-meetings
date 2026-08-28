import { Spinner } from '@heroui/react';

export type LoadingStateVariant = 'section' | 'page';

const VARIANT_CLASS: Record<LoadingStateVariant, string> = {
  section: 'flex justify-center py-12',
  page: 'flex min-h-screen items-center justify-center',
};

interface LoadingStateProps {
  /**
   * What is being loaded, lowercase and unprefixed (`"meetings"`, `"profile"`). The
   * spinner is labelled `Loading {subject}`; omit it for the bare `Loading` used when
   * the thing being waited on has no name a user would recognise.
   */
  subject?: string;
  /**
   * `section` (the default) is the in-page block — a card body or a route's content
   * area. `page` fills the viewport and is for the authenticated group's guard screen,
   * which renders before any layout chrome exists.
   */
  variant?: LoadingStateVariant;
}

/**
 * The centered spinner shown while something is still on its way. One padding and one
 * label form for the whole app: before this existed the same block was written out with
 * three different paddings (`py-4`, `py-12`, full-screen), two spinner sizes and three
 * unrelated `aria-label` values.
 */
export function LoadingState({
  subject,
  variant = 'section',
}: LoadingStateProps) {
  return (
    <div className={VARIANT_CLASS[variant]}>
      <Spinner aria-label={subject ? `Loading ${subject}` : 'Loading'} />
    </div>
  );
}
