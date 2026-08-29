'use client';

import type { ReactNode } from 'react';
import { Button, Modal } from '@heroui/react';
import { ErrorText } from '@/components/ui/ErrorText';

interface ConfirmModalProps {
  /** The consequence of confirming, in the modal's own words. */
  children: ReactNode;
  /** Label of the destructive action, e.g. `"Delete"` or `"Remove"`. */
  confirmLabel: string;
  /** A failure raised by `onConfirm`, rendered inside the dialog rather than behind it. */
  error?: string | null;
  heading: string;
  isOpen: boolean;
  /** True while `onConfirm` is in flight; the confirm button shows its pending state. */
  isPending?: boolean;
  onConfirm: () => void;
  onOpenChange: (isOpen: boolean) => void;
}

/**
 * The app's one "are you sure?" dialog, for destructive actions only — hence the fixed
 * `danger` confirm button and the plain "Cancel" that closes through HeroUI's own
 * `slot="close"`, so Escape, the backdrop, the close control and Cancel all take the
 * same path out.
 *
 * The `error` slot is the reason this is a component rather than two copies of the same
 * JSX: a failure raised by the confirmed action belongs inside the dialog that is still
 * open, next to the button that caused it. Both call sites used to render it in the page
 * behind the modal, where `RecordingCard`'s delete error was invisible until the user
 * dismissed the dialog, and `AvatarSection` needed an `!isRemoveModalOpen` guard to stop
 * the same message appearing twice.
 *
 * The caller keeps the open state and closes the modal itself once the action succeeds;
 * a failure leaves it open with the message.
 */
export function ConfirmModal({
  children,
  confirmLabel,
  error = null,
  heading,
  isOpen,
  isPending = false,
  onConfirm,
  onOpenChange,
}: ConfirmModalProps) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[400px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{heading}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            {children}
            {error ? <ErrorText>{error}</ErrorText> : null}
          </Modal.Body>
          <Modal.Footer>
            {/* Not disabled while pending: Escape and the backdrop stay available
                either way, so disabling only this one way out would be inconsistent. */}
            <Button slot="close" variant="secondary">
              Cancel
            </Button>
            <Button isPending={isPending} onPress={onConfirm} variant="danger">
              {confirmLabel}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
