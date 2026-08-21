'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Avatar, Button, Card, Label, ProgressBar } from '@heroui/react';
import {
  ApiError,
  UploadCancelledError,
  uploadAvatar,
  type Profile,
} from '@/lib/api';
import { UploadIcon } from '@/components/icons';
import { UserAvatar } from '@/components/profile/UserAvatar';

interface AvatarSectionProps {
  profile: Profile;
}

/**
 * Uploads automatically on file selection (no separate "Upload" step), mirroring
 * RecordingUploader's UX. A local `URL.createObjectURL` preview replaces the
 * current-avatar/initials placeholder as soon as a file is picked, and stays up
 * through the upload's progress bar; propagating the result to the header and
 * /profile without a reload is a separate piece of work.
 */
export function AvatarSection({ profile }: AvatarSectionProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const startUpload = (file: File) => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setPreviewUrl(url);
    setError(null);
    setProgress(0);

    uploadAvatar(file, { onProgress: setProgress })
      .then(() => {
        setProgress(null);
      })
      .catch((err: unknown) => {
        setProgress(null);
        if (err instanceof UploadCancelledError) {
          return;
        }
        setError(
          err instanceof ApiError
            ? err.message
            : 'Upload failed. Please try again.',
        );
      });
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    // Guards against a second file slipping in while the first upload is still in flight.
    if (file && !isUploading) {
      startUpload(file);
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
            {previewUrl ? (
              <Avatar color="accent" size="lg" variant="soft">
                <Avatar.Image alt="Selected avatar preview" src={previewUrl} />
              </Avatar>
            ) : (
              <UserAvatar
                avatarUpdatedAt={profile.avatarUpdatedAt}
                email={profile.email}
                hasAvatar={profile.hasAvatar}
                name={profile.name}
                size="profile"
              />
            )}

            <div className="flex flex-col gap-2">
              <Button
                className="h-11 self-start md:h-10"
                isDisabled={isUploading}
                onPress={() => inputRef.current?.click()}
                variant="secondary"
              >
                <UploadIcon aria-hidden="true" className="size-4" />
                Choose photo
              </Button>

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

          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}

          <input
            accept="image/*"
            className="hidden"
            disabled={isUploading}
            onChange={handleFileInputChange}
            ref={inputRef}
            type="file"
          />
        </div>
      </Card.Content>
    </Card>
  );
}
