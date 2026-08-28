'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Avatar, Button, Card, Label, Modal, ProgressBar } from '@heroui/react';
import {
  ApiError,
  UploadCancelledError,
  deleteAvatar,
  uploadAvatar,
  type Profile,
} from '@/lib/api';
import { AVATAR_UPLOAD } from '@/lib/uploads';
import { TrashIcon, UploadIcon } from '@/components/icons';
import { UserAvatar } from '@/components/profile/UserAvatar';

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

function validateFile(file: File): string | null {
  if (!AVATAR_UPLOAD.allowedMimeTypes.includes(file.type)) {
    return `Unsupported file type. Allowed types: ${AVATAR_UPLOAD.allowedExtensionsLabel}.`;
  }
  if (file.size > AVATAR_UPLOAD.maxSizeBytes) {
    return `File is too large. Maximum size is ${AVATAR_UPLOAD.maxSizeLabel}.`;
  }
  return null;
}

/**
 * Selecting a file only stages a local preview (via `URL.createObjectURL`) and a
 * pending `File` — it does not upload. The upload only starts once the user presses
 * "Save"; "Cancel" discards the pending selection (revoking the object URL) and
 * restores the current avatar/initials placeholder without touching the server. On
 * a successful upload, `onProfileChange` is called with just the avatar fields
 * (derived from the upload/delete response, not a refetch, and not merged with the
 * `profile` prop here — see `AvatarSectionProps`) so the header and /profile pick up
 * the change immediately.
 */
export function AvatarSection({
  profile,
  onProfileChange,
}: AvatarSectionProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRemoved, setIsRemoved] = useState(false);
  const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  const isUploading = progress !== null;
  const hasStoredAvatar = profile.hasAvatar && !isRemoved;
  const canRemove = hasStoredAvatar;

  const handleConfirmRemove = async () => {
    setIsRemoving(true);
    setError(null);
    try {
      await deleteAvatar();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setPreviewUrl(null);
      setIsRemoved(true);
      setIsRemoveModalOpen(false);
      onProfileChange({ hasAvatar: false, avatarUpdatedAt: null });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not remove the avatar. Please try again.',
      );
    } finally {
      setIsRemoving(false);
    }
  };

  const stageFile = (file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setPreviewUrl(url);
    setPendingFile(file);
    setError(null);
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    // Guards against a second file slipping in while an upload is still in flight.
    if (file && !isUploading) {
      stageFile(file);
    }
  };

  const handleCancelSelection = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPreviewUrl(null);
    setPendingFile(null);
    setError(null);
  };

  const handleUpload = () => {
    if (!pendingFile) {
      return;
    }
    setError(null);
    setProgress(0);

    uploadAvatar(pendingFile, { onProgress: setProgress })
      .then((avatar) => {
        setProgress(null);
        setPendingFile(null);
        setIsRemoved(false);
        onProfileChange({
          hasAvatar: true,
          avatarUpdatedAt: avatar.updatedAt,
        });
      })
      .catch((err: unknown) => {
        setProgress(null);
        if (err instanceof UploadCancelledError) {
          return;
        }
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = null;
        }
        setPreviewUrl(null);
        setPendingFile(null);
        setError(
          err instanceof ApiError
            ? err.message
            : 'Upload failed. Please try again.',
        );
      });
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
            {previewUrl ? (
              <Avatar color="accent" size="lg" variant="soft">
                <Avatar.Image alt="Selected avatar preview" src={previewUrl} />
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
                {pendingFile ? (
                  <>
                    <Button
                      className="h-11 self-start md:h-10"
                      isDisabled={isUploading}
                      isPending={isUploading}
                      onPress={handleUpload}
                    >
                      Save
                    </Button>

                    <Button
                      className="h-11 self-start md:h-10"
                      isDisabled={isUploading}
                      onPress={handleCancelSelection}
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
                      onPress={() => inputRef.current?.click()}
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

              {isUploading ? (
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

          {error && !isRemoveModalOpen ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}

          <input
            accept={AVATAR_UPLOAD.allowedMimeTypes.join(',')}
            className="hidden"
            disabled={isUploading}
            onChange={handleFileInputChange}
            ref={inputRef}
            type="file"
          />
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
              {error ? (
                <p className="text-sm text-danger" role="alert">
                  {error}
                </p>
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
