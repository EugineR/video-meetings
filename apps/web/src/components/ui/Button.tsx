'use client';

import {
  Button as HeroUIButton,
  type ButtonProps as HeroUIButtonProps,
} from '@heroui/react';
import { touchTarget, type TouchTargetFit } from '@/lib/touchTarget';

interface ButtonProps extends Omit<HeroUIButtonProps, 'className'> {
  /** Extra classes, merged after — and so winning over — the touch-target ones. */
  className?: string;
  /**
   * Which shape this button's touch target takes. Defaults to `square` for an icon-only
   * button and `height` for every other one, which is right almost everywhere; pass it
   * only for the two cases the default cannot see (a multi-line label, or a button nested
   * in a container that is already one target tall). See `src/lib/touchTarget.ts`.
   */
  touchTarget?: TouchTargetFit;
}

/**
 * HeroUI's `Button` with the app's 44px/40px touch target already applied — the reason
 * every button in `src/` imports this instead of `@heroui/react` directly. Sizing used to
 * be a `className="h-11 md:h-10"` an author had to remember, and the buttons that forgot
 * it (both modal footers, both profile Save buttons, the password eye toggle) rendered at
 * HeroUI's default 40px/36px and missed the minimum.
 *
 * `size` still means what it means in HeroUI — text and padding — it just no longer decides
 * the height, so `size="sm"` gives a compact-looking control that is still a full target.
 */
export function Button({
  className,
  isIconOnly,
  touchTarget: fit,
  ...props
}: ButtonProps) {
  return (
    <HeroUIButton
      className={touchTarget({
        className,
        fit: fit ?? (isIconOnly ? 'square' : 'height'),
      })}
      isIconOnly={isIconOnly}
      {...props}
    />
  );
}
