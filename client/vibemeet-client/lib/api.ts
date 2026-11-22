const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface User {
  id: string;
  username: string;
  email: string;
  avatar_url: string | null;
  created_at: string;
}

export interface Community {
  id: string;
  name: string;
  slug: string;
  description: string;
  banner_url: string | null;
  member_count: number;
  created_at: string;
  is_member?: boolean;
  role?: 'admin' | 'member' | null;
}

export interface Thread {
  id: string;
  community_id: string;
  created_by: string;
  title: string;
  description: string | null;
  event_date: string | null;
  location: string | null;
  created_at: string;
}

export interface Photo {
  id: string;
  thread_id: string;
  uploaded_by: string;
  indexed: boolean;
  face_count: number;
  uploaded_at: string;
  thumbnail_url: string;
  download_url: string;
}

export interface SearchMatch {
  photo_id: string;
  similarity: number; // 0..1
  bbox: unknown;
  photo: Photo;
}

export interface SearchResult {
  search_key: string | null;
  matches: SearchMatch[];
  total: number;
  thread_id: string;
}

export interface MyPhoto {
  photo_id: string;
  confidence: number | null;
  confirmed: boolean | null;
  bbox: unknown;
  matched_at: string;
  uploaded_at: string;
  face_count: number;
  uploaded_by: string;
  thumbnail_url: string;
  thread: {
    id: string;
    title: string;
    event_date: string | null;
    location: string | null;
  };
  community: {
    id: string;
    name: string;
    slug: string;
  };
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface FaceEnrollResult {
  message: string;
  selfies_used: number;
  updated: boolean;
}

export interface FaceStatus {
  registered: boolean;
  registered_at: string | null;
}

export function getFaceStatus(token: string): Promise<FaceStatus> {
  return request('/api/users/me/face', { token });
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions {
  method?: string;
  token?: string | null;
  body?: unknown;
  isFormData?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', token, body, isFormData = false } = options;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body && !isFormData) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body ? (isFormData ? (body as BodyInit) : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new ApiError(
      `Could not reach the API at ${API_URL}. Is the server running?`,
      0,
      null
    );
  }

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const message =
      (data && typeof data.error === 'string' && data.error) ||
      `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

export function requestRegisterOtp(args: {
  username: string;
  email: string;
  password: string;
}): Promise<{ email: string }> {
  return request('/api/auth/register/request', { method: 'POST', body: args });
}

export function verifyRegisterOtp(args: {
  email: string;
  code: string;
}): Promise<{ token: string; user: User }> {
  return request('/api/auth/register/verify', { method: 'POST', body: args });
}

export function resendRegisterOtp(args: {
  email: string;
}): Promise<{ email: string; message?: string }> {
  return request('/api/auth/register/resend', { method: 'POST', body: args });
}

export function login(args: {
  email: string;
  password: string;
}): Promise<{ token: string; user: User }> {
  return request('/api/auth/login', { method: 'POST', body: args });
}

export function getMe(token: string): Promise<{ user: User }> {
  return request('/api/users/me', { token });
}

export function registerFace(token: string, files: File[]): Promise<FaceEnrollResult> {
  const form = new FormData();
  for (const file of files) form.append('selfies', file);
  return request('/api/users/me/face', {
    method: 'POST',
    token,
    body: form,
    isFormData: true,
  });
}

export function deleteFace(token: string): Promise<{ message: string }> {
  return request('/api/users/me/face', { method: 'DELETE', token });
}

export function getMyPhotos(
  token: string,
  { page = 1, limit = 12 }: { page?: number; limit?: number } = {}
): Promise<{ photos: MyPhoto[]; pagination: Pagination }> {
  return request(`/api/users/me/photos?page=${page}&limit=${limit}`, { token });
}

export function confirmMatch(
  token: string,
  photoId: string,
  action: 'confirm' | 'reject'
): Promise<{ match: { photo_id: string; confirmed: boolean } }> {
  return request(`/api/users/me/photos/${photoId}/confirm`, {
    method: 'PATCH',
    token,
    body: { action },
  });
}

export function listCommunities(): Promise<{ communities: Community[] }> {
  return request('/api/communities');
}

export function getCommunity(slug: string, token: string): Promise<{ community: Community }> {
  return request(`/api/communities/${slug}`, { token });
}

export function createCommunity(
  token: string,
  args: { name: string; description: string }
): Promise<{ community: Community }> {
  return request('/api/communities', { method: 'POST', token, body: args });
}

export function joinCommunity(
  token: string,
  communityId: string
): Promise<{ message: string }> {
  return request(`/api/communities/${communityId}/join`, { method: 'POST', token });
}

export function leaveCommunity(
  token: string,
  communityId: string
): Promise<{ message: string }> {
  return request(`/api/communities/${communityId}/leave`, { method: 'POST', token });
}

export function listThreads(communityId: string): Promise<{ threads: Thread[] }> {
  return request(`/api/communities/${communityId}/threads`);
}

export function getThread(threadId: string): Promise<{ thread: Thread }> {
  return request(`/api/threads/${threadId}`);
}

export function createThread(
  token: string,
  communityId: string,
  args: {
    title: string;
    description: string | null;
    event_date: string | null;
    location: string | null;
  }
): Promise<{ thread: Thread }> {
  return request(`/api/communities/${communityId}/threads`, {
    method: 'POST',
    token,
    body: args,
  });
}

export function listThreadPhotos(
  token: string,
  threadId: string
): Promise<{ photos: Photo[]; indexed_count: number; total_count: number }> {
  return request(`/api/photos/thread/${threadId}`, { token });
}

export function uploadPhoto(
  token: string,
  threadId: string,
  file: File
): Promise<{ photo: Photo }> {
  const form = new FormData();
  form.append('thread_id', threadId);
  form.append('file', file);
  return request('/api/photos', { method: 'POST', token, body: form, isFormData: true });
}

export function recoverPhotoDownload(
  token: string,
  photoId: string
): Promise<{ download_url: string }> {
  return request(`/api/photos/${photoId}/download`, { token });
}

export function searchFaces(
  token: string,
  thread_id: string,
  threshold?: number
): Promise<SearchResult> {
  return request('/api/search', {
    method: 'POST',
    token,
    body: threshold ? { thread_id, threshold } : { thread_id },
  });
}

export async function downloadZip(
  token: string,
  search_key: string,
  photo_ids?: string[]
): Promise<void> {
  const res = await fetch(`${API_URL}/api/search/zip`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(
      photo_ids && photo_ids.length > 0 ? { search_key, photo_ids } : { search_key }
    ),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const message =
      (data && typeof data.error === 'string' && data.error) ||
      `Zip download failed (${res.status})`;
    throw new ApiError(message, res.status, data);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'vibemeet-photos.zip';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
