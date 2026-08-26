import { getAccessToken } from '@/lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface AccessTokenResponse {
  accessToken: string;
}

export interface Meeting {
  id: string;
  title: string;
  date: string;
  participants: string[];
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export type RecordingStatus = 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';

export interface Recording {
  id: string;
  meetingId: string;
  originalFilename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: string;
  status: RecordingStatus;
  transcriptText: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingDetail extends Meeting {
  recording: Recording | null;
}

export interface MeetingListItem extends Meeting {
  hasRecording: boolean;
}

export interface Profile {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  hasAvatar: boolean;
  avatarUpdatedAt: string | null;
}

export interface Avatar {
  id: string;
  userId: string;
  originalFilename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: string;
  createdAt: string;
  updatedAt: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Thrown by `uploadMeetingRecording` when its `signal` is aborted — distinct from `ApiError` since it isn't a server response. */
export class UploadCancelledError extends Error {
  constructor() {
    super('Upload cancelled');
    this.name = 'UploadCancelledError';
  }
}

function extractErrorMessage(payload: unknown): string {
  return payload &&
    typeof payload === 'object' &&
    'message' in payload &&
    typeof payload.message === 'string'
    ? payload.message
    : 'Something went wrong. Please try again.';
}

async function handleResponse<TResponse>(
  response: Response,
): Promise<TResponse> {
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new ApiError(extractErrorMessage(payload), response.status);
  }

  // 204 No Content (e.g. DELETE routes) has no body to parse.
  if (response.status === 204) {
    return undefined as TResponse;
  }

  return response.json() as Promise<TResponse>;
}

async function postJson<TResponse>(
  path: string,
  body: unknown,
): Promise<TResponse> {
  const token = getAccessToken();
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  return handleResponse<TResponse>(response);
}

async function getJson<TResponse>(path: string): Promise<TResponse> {
  const token = getAccessToken();
  const response = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  return handleResponse<TResponse>(response);
}

async function patchJson<TResponse>(
  path: string,
  body: unknown,
): Promise<TResponse> {
  const token = getAccessToken();
  const response = await fetch(`${API_URL}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  return handleResponse<TResponse>(response);
}

export function registerUser(
  email: string,
  password: string,
): Promise<AccessTokenResponse> {
  return postJson<AccessTokenResponse>('/auth/register', { email, password });
}

export function loginUser(
  email: string,
  password: string,
): Promise<AccessTokenResponse> {
  return postJson<AccessTokenResponse>('/auth/login', { email, password });
}

export function getMeetings(): Promise<MeetingListItem[]> {
  return getJson<MeetingListItem[]>('/meetings');
}

export function getMeeting(id: string): Promise<MeetingDetail> {
  return getJson<MeetingDetail>(`/meetings/${id}`);
}

/**
 * The URL for a `<video>`/`<audio>` player's `src`. Media elements can't set an
 * `Authorization` header, so the access token rides along as a `?token=` query
 * param instead — `JwtAuthGuard` on the API accepts either.
 */
export function getRecordingContentUrl(meetingId: string): string {
  const token = getAccessToken();
  const url = new URL(`${API_URL}/meetings/${meetingId}/recording/content`);
  if (token) {
    url.searchParams.set('token', token);
  }
  return url.toString();
}

export interface UploadRecordingOptions {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/**
 * XHR-based (not `fetch`) because it's the only way to get upload progress events
 * in the browser; everything else in this file uses `fetch`.
 */
export function uploadMeetingRecording(
  meetingId: string,
  file: File,
  { onProgress, signal }: UploadRecordingOptions = {},
): Promise<Recording> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/meetings/${meetingId}/recording`);

    const token = getAccessToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      let payload: unknown = null;
      try {
        payload = xhr.responseText
          ? (JSON.parse(xhr.responseText) as unknown)
          : null;
      } catch {
        payload = null;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as Recording);
      } else {
        reject(new ApiError(extractErrorMessage(payload), xhr.status));
      }
    };

    xhr.onerror = () => {
      reject(new ApiError('Network error. Please try again.', 0));
    };

    xhr.onabort = () => {
      reject(new UploadCancelledError());
    };

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener('abort', () => xhr.abort());
    }

    const formData = new FormData();
    formData.append('file', file);
    xhr.send(formData);
  });
}

export async function deleteMeetingRecording(meetingId: string): Promise<void> {
  const token = getAccessToken();
  const response = await fetch(`${API_URL}/meetings/${meetingId}/recording`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  await handleResponse<void>(response);
}

export function getProfile(): Promise<Profile> {
  return getJson<Profile>('/users/me');
}

export function updateProfile(name: string | null): Promise<Profile> {
  return patchJson<Profile>('/users/me', { name });
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<AccessTokenResponse> {
  return postJson<AccessTokenResponse>('/users/me/password', {
    currentPassword,
    newPassword,
  });
}

/**
 * The URL for a `UserAvatar`-backed `<img>`'s `src`. Image elements can't set an
 * `Authorization` header, so the access token rides along as a `?token=` query
 * param instead — `JwtAuthGuard` on the API accepts either. `avatarUpdatedAt` rides
 * along too, so a replaced avatar busts the browser's cache instead of showing the
 * previous file at the same URL.
 */
export function getAvatarUrl(avatarUpdatedAt: string | null): string {
  const token = getAccessToken();
  const url = new URL(`${API_URL}/users/me/avatar`);
  if (token) {
    url.searchParams.set('token', token);
  }
  if (avatarUpdatedAt) {
    url.searchParams.set('v', avatarUpdatedAt);
  }
  return url.toString();
}

export interface UploadAvatarOptions {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/**
 * XHR-based (not `fetch`) because it's the only way to get upload progress events
 * in the browser; everything else in this file uses `fetch`.
 */
export function uploadAvatar(
  file: File,
  { onProgress, signal }: UploadAvatarOptions = {},
): Promise<Avatar> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/users/me/avatar`);

    const token = getAccessToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      let payload: unknown = null;
      try {
        payload = xhr.responseText
          ? (JSON.parse(xhr.responseText) as unknown)
          : null;
      } catch {
        payload = null;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as Avatar);
      } else {
        reject(new ApiError(extractErrorMessage(payload), xhr.status));
      }
    };

    xhr.onerror = () => {
      reject(new ApiError('Network error. Please try again.', 0));
    };

    xhr.onabort = () => {
      reject(new UploadCancelledError());
    };

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener('abort', () => xhr.abort());
    }

    const formData = new FormData();
    formData.append('file', file);
    xhr.send(formData);
  });
}

export async function deleteAvatar(): Promise<void> {
  const token = getAccessToken();
  const response = await fetch(`${API_URL}/users/me/avatar`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  await handleResponse<void>(response);
}
