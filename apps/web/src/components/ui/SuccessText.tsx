'use client';

import type { ReactNode } from 'react';

interface SuccessTextProps {
  children: ReactNode;
}

/**
 * The success counterpart of `ErrorText`: the "saved" confirmation line under a form.
 *
 * `role="status"` rather than `role="alert"` on purpose — a confirmation is polite, so
 * a screen reader finishes what it is saying before announcing it, while an error
 * interrupts. Prop-less beyond its children for the same reason as `ErrorText`.
 */
export function SuccessText({ children }: SuccessTextProps) {
  return (
    <p className="text-sm text-success" role="status">
      {children}
    </p>
  );
}
