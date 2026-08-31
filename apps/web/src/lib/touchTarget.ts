import { tv, type VariantProps } from 'tailwind-variants';

/**
 * The single expression of the app's 44px (mobile) / 40px (desktop) minimum touch target.
 *
 * It replaces the three forms this used to be spelled in — `h-11 md:h-10` hand-written on
 * every button and field, HeroUI's `size="lg"` (which happens to compile to the same two
 * heights), and `min-h-[44px] md:min-h-10` — so meeting the minimum is no longer a
 * convention an author can silently forget. `@/components/ui/Button` applies it to every
 * button on its own; the field primitives, the one non-control slot that has to line up
 * with a button, a link that stands on its own as a control (the header's `/profile`
 * link), and every `Modal.CloseTrigger` (HeroUI ships it at a fixed 24px, in the same
 * `components` layer `Button` overrides — its icon has its own fixed size, so growing the
 * trigger only enlarges the hit area) call this recipe directly. A link that is inline
 * text inside a sentence — the "Create one"/"Sign in" footers on the auth pages — is the
 * deliberate exception: padding it to 44px would break the line it sits in, and the
 * sentence around it is the target.
 *
 * The classes are Tailwind utilities on purpose: HeroUI ships its control heights in the
 * `components` cascade layer, which the `utilities` layer overrides, so these win over
 * `.button`/`.input-group` without `!important`.
 */
export const touchTarget = tv({
  variants: {
    fit: {
      /** A control whose own content decides its height — a multi-line label. */
      block: 'h-auto min-h-11 md:min-h-10',
      /** A control that is exactly one touch target tall. The default. */
      height: 'h-11 md:h-10',
      /**
       * A control nested inside a container that is itself one touch target tall — the
       * show/hide toggle in a `PasswordField`'s `InputGroup`. It fills the container's
       * content box rather than being pinned to 44px, which would overflow the field's
       * border box by the width of its border.
       */
      inset: 'h-full w-11 md:w-10',
      /** An icon-only control: the minimum applies to the width as well. */
      square: 'size-11 md:size-10',
    },
  },
  defaultVariants: { fit: 'height' },
});

/** Which shape a control's touch target takes; see the variants above. */
export type TouchTargetFit = NonNullable<
  VariantProps<typeof touchTarget>['fit']
>;
