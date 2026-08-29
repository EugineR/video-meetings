'use client';

import { useState } from 'react';
import { Avatar, Button, Card, Label, Modal, ProgressBar } from '@heroui/react';
import { ApiError, deleteAvatar, uploadAvatar, type Profile } from '@/lib/api';
import { AVATAR_UPLOAD } from '@/lib/uploads';
import { useFileSelection } from '@/lib/useFileSelection';
import { TrashIcon, UploadIcon } from '@/components/icons';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { ErrorText } from '@/components/ui/ErrorText';

interface AvatarSectionProps {
  profile: Profile;
  /**
   * Called with only the avatar-specific fields right after a successful
   * upload or removal, so the caller can merge them (e.g. into the header)
   * without refetching. Deliberately a delta, not a full `Profile` built from
   * the `profile` prop: this callback can resolve well after it captured
   * `profile` (an upload has its own progress bar), by which point another
   * section may have saved a newer profile — spreading the stale `profile`
   * here would clobber that update.
   */
  onProfileChange: (profile: Partial<Profile>) => void;
}

/**
 * Selecting a file only stages it — `useFileSelection` in `'staged'` mode keeps
 * the `File` and a local `URL.createObjectURL` preview, and nothing is sent.
 * The upload starts only when the user presses "Save"; "Cancel" discards the
 * pending selection (revoking the object URL) and restores the current
 * avatar/initials placeholder without touching the server. On a successful
 * upload, `onProfileChange` is called with just the avatar fields (derived from
 * the upload/delete response, not a refetch, and not merged with the `profile`
 * prop here — see `AvatarSectionProps`) so the header and /profile pick up the
 * change immediately.
 */
export function AvatarSection({
  profile,
  onProfileChange,
}: AvatarSectionProps) {
  const [isRemoved, setIsRemoved] = useState(false);
  const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const selection = useFileSelection({
    constraints: AVATAR_UPLOAD,
    mode: 'staged',
    upload: uploadAvatar,
    onUploaded: (avatar) => {
      setIsRemoved(false);
      onProfileChange({ hasAvatar: true, avatarUpdatedAt: avatar.updatedAt });
    },
  });

  const { isUploading, progress } = selection;
  const hasStoredAvatar = profile.hasAvatar && !isRemoved;
  const canRemove = hasStoredAvatar;

  const handleConfirmRemove = async () => {
    setIsRemoving(true);
    selection.setError(null);
    try {
      await deleteAvatar();
      selection.clearSelection();
      setIsRemoved(true);
      setIsRemoveModalOpen(false);
      onProfileChange({ hasAvatar: false, avatarUpdatedAt: null });
    } catch (err) {
      selection.setError(
        err instanceof ApiError
          ? err.message
          : 'Could not remove the avatar. Please try again.',
      );
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <Card>
      <Card.Header>
        <Card.Title>Avatar</Card.Title>
        <Card.Description>
          Shown next to your name across the app.
        </Card.Description>
      </Card.Header>

      <Card.Content>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            {selection.previewUrl ? (
              <Avatar color="accent" size="lg" variant="soft">
                <Avatar.Image
                  alt="Selected avatar preview"
                  src={selection.previewUrl}
                />
              </Avatar>
            ) : (
              <UserAvatar
                avatarUpdatedAt={profile.avatarUpdatedAt}
                email={profile.email}
                hasAvatar={hasStoredAvatar}
                name={profile.name}
                size="profile"
              />
            )}

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                {selection.selectedFile ? (
                  <>
                    <Button
                      className="h-11 self-start md:h-10"
                      isDisabled={isUploading}
                      isPending={isUploading}
                      onPress={selection.uploadSelectedFile}
                    >
                      Save
                    </Button>

                    <Button
                      className="h-11 self-start md:h-10"
                      isDisabled={isUploading}
                      onPress={selection.clearSelection}
                      variant="secondary"
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      className="h-11 self-start md:h-10"
                      isDisabled={isRemoving}
                      onPress={selection.openFilePicker}
                      variant="secondary"
                    >
                      <UploadIcon aria-hidden="true" className="size-4" />
                      Choose photo
                    </Button>

                    {canRemove ? (
                      <Button
                        className="h-11 self-start md:h-10"
                        isDisabled={isRemoving}
                        onPress={() => setIsRemoveModalOpen(true)}
                        variant="danger"
                      >
                        <TrashIcon aria-hidden="true" className="size-4" />
                        Remove avatar
                      </Button>
                    ) : null}
                  </>
                )}
              </div>

              <p className="text-xs text-muted">
                {AVATAR_UPLOAD.allowedExtensionsLabel} · up to{' '}
                {AVATAR_UPLOAD.maxSizeLabel}
              </p>

              {progress !== null ? (
                <ProgressBar
                  aria-label="Avatar upload progress"
                  className="w-48"
                  value={progress}
                >
                  <Label>Uploading…</Label>
                  <ProgressBar.Output />
                  <ProgressBar.Track>
                    <ProgressBar.Fill />
                  </ProgressBar.Track>
                </ProgressBar>
              ) : null}
            </div>
          </div>

          {selection.error && !isRemoveModalOpen ? (
            <ErrorText>{selection.error}</ErrorText>
          ) : null}

          <input {...selection.inputProps} />
        </div>
      </Card.Content>

      <Modal.Backdrop
        isOpen={isRemoveModalOpen}
        onOpenChange={setIsRemoveModalOpen}
      >
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[400px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Remove avatar?</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p>
                This will remove your profile photo. You can upload a new one at
                any time.
              </p>
              {selection.error ? (
                <ErrorText>{selection.error}</ErrorText>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="secondary">
                Cancel
              </Button>
              <Button
                isPending={isRemoving}
                onPress={() => void handleConfirmRemove()}
                variant="danger"
              >
                Remove
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Card>
  );
}
