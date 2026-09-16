// lib/api.js
//
// Thin fetch wrapper around the VibeMeet Express API (see ../../api/src/routes).
// Every function here mirrors one route exactly — same path, same method, same
// body shape, same response shape — so this file should never drift from the
// backend without both sides being updated together.
//
// Auth: the API expects `Authorization: Bearer <jwt>`. The token is passed in
// explicitly by callers (see AuthProvider) rather than read from storage here,
// so this module has no dependency on the browser and stays easy to reason about.

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

// Every error path in the API responds with { error: string }. We surface
// that string as the thrown Error's message so callers can show it directly.
async function request(path, { method = 'GET', token, body, isFormData = false } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body && !isFormData) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    });
  } catch (networkErr) {
    throw new ApiError(
      `Could not reach the API at ${API_URL}. Is the server running?`,
      0,
      null
    );
  }

  // 204s and the zip stream endpoint don't return JSON.
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data);
  }
  return data;
}

// ── Auth ─────────────────────────────────────────────────────────────────────
export function register({ username, email, password }) {
  return request('/api/auth/register', { method: 'POST', body: { username, email, password } });
}

export function login({ email, password }) {
  return request('/api/auth/login', { method: 'POST', body: { email, password } });
}

// ── Users ────────────────────────────────────────────────────────────────────
export function getMe(token) {
  return request('/api/users/me', { token });
}

export function registerFace(token, files) {
  const form = new FormData();
  for (const file of files) form.append('selfies', file);
  return request('/api/users/me/face', { method: 'POST', token, body: form, isFormData: true });
}

export function deleteFace(token) {
  return request('/api/users/me/face', { method: 'DELETE', token });
}

export function getMyPhotos(token, { page = 1, limit = 20 } = {}) {
  return request(`/api/users/me/photos?page=${page}&limit=${limit}`, { token });
}

export function confirmMatch(token, photoId, action) {
  return request(`/api/users/me/photos/${photoId}/confirm`, {
    method: 'PATCH',
    token,
    body: { action }, // 'confirm' | 'reject'
  });
}

// ── Communities ──────────────────────────────────────────────────────────────
export function listCommunities() {
  return request('/api/communities');
}

export function getCommunity(slug) {
  return request(`/api/communities/${slug}`);
}

export function createCommunity(token, { name, description }) {
  return request('/api/communities', { method: 'POST', token, body: { name, description } });
}

export function joinCommunity(token, communityId) {
  return request(`/api/communities/${communityId}/join`, { method: 'POST', token });
}

// ── Threads ──────────────────────────────────────────────────────────────────
export function listThreads(communityId) {
  return request(`/api/communities/${communityId}/threads`);
}

export function getThread(threadId) {
  return request(`/api/threads/${threadId}`);
}

export function createThread(token, communityId, { title, description, event_date, location }) {
  return request(`/api/communities/${communityId}/threads`, {
    method: 'POST',
    token,
    body: { title, description, event_date, location },
  });
}

// ── Photos ───────────────────────────────────────────────────────────────────
export function listThreadPhotos(threadId) {
  return request(`/api/photos/thread/${threadId}`);
}

export function uploadPhoto(token, threadId, file) {
  const form = new FormData();
  form.append('thread_id', threadId);
  form.append('file', file);
  return request('/api/photos', { method: 'POST', token, body: form, isFormData: true });
}

export function recoverPhotoDownload(token, photoId) {
  return request(`/api/photos/${photoId}/download`, { token });
}

// ── Search ───────────────────────────────────────────────────────────────────
export function searchFaces(token, thread_id, threshold) {
  return request('/api/search', {
    method: 'POST',
    token,
    body: threshold ? { thread_id, threshold } : { thread_id },
  });
}

export function getDownloadUrls(token, search_key, photo_ids) {
  return request('/api/search/download', { method: 'POST', token, body: { search_key, photo_ids } });
}

// The zip endpoint streams binary — call it directly rather than through
// request(), and let the browser handle the download via an object URL.
export async function downloadZip(token, search_key) {
  const res = await fetch(`${API_URL}/api/search/zip`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ search_key }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(data?.error || `Zip download failed (${res.status})`, res.status, data);
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
