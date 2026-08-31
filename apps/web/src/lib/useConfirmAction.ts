'use client';

import { useState } from 'react';
import { apiErrorMessage } from '@/lib/formErrors';

export interface UseConfirmActionOptions {
  /**
   * Runs the destructive request and whatever local state it earns on success — e.g.
   * `deleteMeetingRecording` then `onDeleted(recording.id)`. A rejection is read as the
   * failure to show; anything this throws after the request itself succeeds would
   * incorrectly render as "delete failed", so keep it to the request and its own
   * caller-side bookkeeping.
   */
  action: () => Promise<void>;
  /** Shown for a failure that isn't an `ApiError` — a network failure, say. */
  fallbackMessage: string;
}

export interface ConfirmAction {
  /** Opens the dialog. */
  open: () => void;
  /** `ConfirmModal`'s own props, spread directly: `isOpen`, `onOpenChange`, `isPending`, `error`, and `onConfirm`. */
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  error: string | null;
  onConfirm: () => void;
}

/**
 * The open/pending/error mechanics behind every `ConfirmModal` call site: `open()` shows
 * the dialog, `onConfirm` runs `action`, closing the dialog only once it resolves and
 * leaving it open with `error` set otherwise — the caller never touches `isOpen` on
 * failure, and `onOpenChange` (wired to the dialog's Escape/backdrop/Cancel/close paths)
 * clears a stale error rather than leaving it to reappear on the next open.
 *
 * `RecordingCard`'s delete confirmation and `AvatarSection`'s remove confirmation used to
 * each hand-write this same shape — three state variables, an `onOpenChange` that resets
 * the error, and a `try`/`catch`/`finally` around the request. Only what happens inside
 * `action` differs between them.
 */
export function useConfirmAction({
  action,
  fallbackMessage,
}: UseConfirmActionOptions): ConfirmAction {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onOpenChange = (open: boolean) => {
    setError(null);
    setIsOpen(open);
  };

  const onConfirm = () => {
    setIsPending(true);
    setError(null);
    action()
      .then(() => setIsOpen(false))
      .catch((err: unknown) => setError(apiErrorMessage(err, fallbackMessage)))
      .finally(() => setIsPending(false));
  };

  return {
    open: () => setIsOpen(true),
    isOpen,
    onOpenChange,
    isPending,
    error,
    onConfirm,
  };
}
