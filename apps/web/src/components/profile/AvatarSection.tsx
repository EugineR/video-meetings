'use client';

import { useState } from 'react';
import { Avatar, Button, Card, Label, ProgressBar } from '@heroui/react';
import { ApiError, deleteAvatar, uploadAvatar, type Profile } from '@/lib/api';
import type { ProfileSaved } from '@/lib/queries/profile';
import { AVATAR_UPLOAD } from '@/lib/uploads';
import { useFileSelection } from '@/lib/useFileSelection';
import { TrashIcon, UploadIcon } from '@/components/icons';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { ErrorText } from '@/components/ui/ErrorText';
import { UserAvatar } from '@/components/ui/UserAvatar';

interface AvatarSectionProps {
  /**
   * The shared "saved, here is the result" callback (see `ProfileSaved`): only the
   * avatar-specific fields, right after a successful upload or removal, for the caller
   * to merge (e.g. into the header) without refetching.
   */
  onSaved: (saved: ProfileSaved) => void;
  profile: Profile;
}

/**
 * Selecting a file only stages it — `useFileSelection` in `'staged'` mode keeps
 * the `File` and a local `URL.createObjectURL` preview, and nothing is sent.
 * The upload starts only when the user presses "Save"; "Cancel" discards the
 * pending selection (revoking the object URL) and restores the current
 * avatar/initials placeholder without touching the server. On a successful
 * upload, `onSaved` is called with just the avatar fields (derived from the
 * upload/delete response, not a refetch, and not merged with the `profile` prop
 * here — see `ProfileSaved`) so the header and /profile pick up the change
 * immediately.
 *
 * Removal keeps its own `removeError`, separate from the selection's upload error:
 * one belongs inside the confirmation dialog, the other under the buttons.
 */
export function AvatarSection({ onSaved, profile }: AvatarSectionProps) {
  const [isRemoved, setIsRemoved] = useState(false);
  const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const selection = useFileSelection({
    constraints: AVATAR_UPLOAD,
    mode: 'staged',
    upload: uploadAvatar,
    onUploaded: (avatar) => {
      setIsRemoved(false);
      onSaved({
        profile: { hasAvatar: true, avatarUpdatedAt: avatar.updatedAt },
      });
    },
  });

  const { isUploading, progress } = selection;
  const hasStoredAvatar = profile.hasAvatar && !isRemoved;
  const canRemove = hasStoredAvatar;

  const handleRemoveOpenChange = (isOpen: boolean) => {
    setRemoveError(null);
    setIsRemoveModalOpen(isOpen);
  };

  const handleConfirmRemove = async () => {
    setIsRemoving(true);
    setRemoveError(null);
    try {
      await deleteAvatar();
      selection.clearSelection();
      setIsRemoved(true);
      setIsRemoveModalOpen(false);
      onSaved({ profile: { hasAvatar: false, avatarUpdatedAt: null } });
    } catch (err) {
      setRemoveError(
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

          {selection.error ? <ErrorText>{selection.error}</ErrorText> : null}

          <input {...selection.inputProps} />
        </div>
      </Card.Content>

      <ConfirmModal
        confirmLabel="Remove"
        error={removeError}
        heading="Remove avatar?"
        isOpen={isRemoveModalOpen}
        isPending={isRemoving}
        onConfirm={() => void handleConfirmRemove()}
        onOpenChange={handleRemoveOpenChange}
      >
        <p>
          This will remove your profile photo. You can upload a new one at any
          time.
        </p>
      </ConfirmModal>
    </Card>
  );
}
