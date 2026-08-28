import type { ReactNode } from 'react';

interface ErrorTextProps {
  children: ReactNode;
}

/**
 * The app's single error message line: small, `text-danger`, and announced by
 * assistive technology through `role="alert"` the moment it appears. Every surface
 * that reports a failure inline — form-level API errors, a failed fetch, a rejected
 * file, a failed transcription — renders one of these.
 *
 * It is deliberately prop-less beyond its children: the whole point of the primitive
 * is that an error looks and announces the same everywhere, so there is no `className`
 * escape hatch to drift through. This is the only file in `src/` allowed to carry the
 * raw `text-sm text-danger` class string.
 */
export function ErrorText({ children }: ErrorTextProps) {
  return (
    <p className="text-sm text-danger" role="alert">
      {children}
    </p>
  );
}
