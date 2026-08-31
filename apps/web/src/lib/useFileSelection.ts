'use client';

import { useEffect, useRef, useState, type ChangeEvent, type Ref } from 'react';
import { UploadCancelledError, type UploadOptions } from '@/lib/api';
import { apiErrorMessage } from '@/lib/formErrors';
import { validateFile, type UploadConstraints } from '@/lib/uploads';

export interface FileSelectionOptions<TResult> {
  /** The allowlist and size cap this picker enforces — from `src/lib/uploads.ts`. */
  constraints: UploadConstraints;
  /**
   * `'immediate'` uploads a file as soon as it is picked or dropped (the
   * recording drop zone); `'staged'` only keeps it, with a local
   * `URL.createObjectURL` preview, until `uploadSelectedFile()` is called (the
   * avatar's stage-then-Save flow, where selecting must not upload on its own).
   */
  mode: 'immediate' | 'staged';
  /** The `src/lib/api.ts` upload call, already bound to whatever it uploads into. */
  upload: (file: File, options: UploadOptions) => Promise<TResult>;
  /** Called with the API's response once the upload succeeds. */
  onUploaded: (result: TResult) => void;
}

export interface FileSelection {
  /** Spread onto a hidden `<input type="file">`; the hook owns its ref and reset. */
  inputProps: {
    accept: string;
    className: string;
    disabled: boolean;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
    ref: Ref<HTMLInputElement>;
    type: 'file';
  };
  /** Opens the hidden input's native picker. */
  openFilePicker: () => void;
  /** Takes a file from anywhere else — a drop, a paste — through the same path. */
  selectFile: (file: File) => void;
  /** The staged file in `'staged'` mode; always `null` in `'immediate'` mode. */
  selectedFile: File | null;
  /** Object URL of the staged file, kept after a successful upload. */
  previewUrl: string | null;
  /** 0–100 while an upload is in flight, `null` otherwise. */
  progress: number | null;
  isUploading: boolean;
  /**
   * A rejected file or a failed upload; never a cancellation. Read-only on purpose —
   * a failure the owning component raises itself (deleting an avatar, say) is its own
   * state, and routing it through here is what once put a removal error under the
   * uploader's buttons instead of inside the confirmation dialog that caused it.
   */
  error: string | null;
  /** Drops the staged file and its preview without touching the server. */
  clearSelection: () => void;
  /** Uploads the staged file; a no-op when nothing is staged. */
  uploadSelectedFile: () => void;
  /** Aborts an in-flight upload — resolves as `UploadCancelledError`, not an error state. */
  cancelUpload: () => void;
}

/**
 * The file-picking half of both uploaders: the hidden `<input>`, the one
 * client-side `validateFile` call, the staged file and its object-URL
 * lifecycle, upload progress and cancellation.
 *
 * Two invariants live here rather than at the call sites, which is the point of
 * the hook: a file arriving while an upload is in flight is ignored (the guard
 * exists once, so a fast second pick or a mid-upload drop cannot take the
 * `AbortController` away from the request already running), and a rejection
 * with `UploadCancelledError` returns before any error state is set, so a
 * user-initiated cancel never renders as a failure.
 */
export function useFileSelection<TResult>({
  constraints,
  mode,
  upload,
  onUploaded,
}: FileSelectionOptions<TResult>): FileSelection {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      // Aborting here — rather than leaving the request to resolve on its own —
      // is what keeps `startUpload`'s `.then`/`.catch` from touching this hook's
      // state after the owning component is gone: the abort rejects with
      // `UploadCancelledError`, which the catch already treats as a no-op.
      abortControllerRef.current?.abort();
    };
  }, []);

  const isUploading = progress !== null;

  const revokePreview = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const discardSelection = () => {
    revokePreview();
    setPreviewUrl(null);
    setSelectedFile(null);
  };

  const startUpload = (file: File) => {
    setError(null);
    setProgress(0);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    upload(file, { onProgress: setProgress, signal: controller.signal })
      .then((result) => {
        setProgress(null);
        // The preview stays: it already shows exactly what was just stored.
        setSelectedFile(null);
        onUploaded(result);
      })
      .catch((err: unknown) => {
        setProgress(null);
        if (err instanceof UploadCancelledError) {
          return;
        }
        discardSelection();
        setError(apiErrorMessage(err, 'Upload failed. Please try again.'));
      });
  };

  const selectFile = (file: File) => {
    // Guards against a second file slipping in (a fast repeat pick, a drop on
    // the zone) while the first upload's request is still in flight.
    if (isUploading) {
      return;
    }

    const validationError = validateFile(file, constraints);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (mode === 'immediate') {
      startUpload(file);
      return;
    }

    revokePreview();
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setPreviewUrl(url);
    setSelectedFile(file);
    setError(null);
  };

  return {
    inputProps: {
      accept: constraints.allowedMimeTypes.join(','),
      className: 'hidden',
      disabled: isUploading,
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        // Reset first, so re-picking the same file still fires a change event.
        event.target.value = '';
        if (file) {
          selectFile(file);
        }
      },
      ref: inputRef,
      type: 'file',
    },
    openFilePicker: () => inputRef.current?.click(),
    selectFile,
    selectedFile,
    previewUrl,
    progress,
    isUploading,
    error,
    clearSelection: () => {
      discardSelection();
      setError(null);
    },
    uploadSelectedFile: () => {
      if (selectedFile) {
        startUpload(selectedFile);
      }
    },
    cancelUpload: () => abortControllerRef.current?.abort(),
  };
}
