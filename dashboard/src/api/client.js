// src/api/client.js
//
// The one place that knows how to talk to the backend. Everything else
// (pages, hooks, context) goes through this module — nothing else should
// call fetch() directly against /api/*.

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const TOKEN_STORAGE_KEY = 'sa_teacher_token';

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function parseJsonSafely(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * POST /api/auth/request-code
 * Always resolves to { success: true } regardless of whether the phone
 * is known — the backend intentionally does not reveal that (ADR-008).
 */
export async function requestCode(phone) {
  const res = await fetch(`${API_BASE_URL}/api/auth/request-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  const body = await parseJsonSafely(res);
  if (!res.ok) {
    throw new ApiError(body?.error || 'Failed to request code', res.status, body);
  }
  return body;
}

/**
 * POST /api/auth/verify-code
 * Returns { accessToken, tokenType, expiresIn, teacher: {id, name} } on success.
 */
export async function verifyCode(phone, code) {
  const res = await fetch(`${API_BASE_URL}/api/auth/verify-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code }),
  });
  const body = await parseJsonSafely(res);
  if (!res.ok) {
    throw new ApiError(body?.error || 'Verification failed', res.status, body);
  }
  return body;
}

/**
 * Wraps fetch() with the stored Bearer token. On a 401 it clears the
 * stored token — the JWT is 1h with no refresh flow (ADR-008), so a 401
 * here means "session expired, log in again," not "retry."
 *
 * Callers should catch the thrown ApiError and redirect to /login on
 * status === 401 (see hooks/useAuthedFetch or TeacherContext).
 */
export async function authenticatedFetch(path, options = {}) {
  const token = getStoredToken();
  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearStoredToken();
  }

  const body = await parseJsonSafely(res);
  if (!res.ok) {
    throw new ApiError(body?.error || `Request failed (${res.status})`, res.status, body);
  }
  return body;
}

const TEACHER_STORAGE_KEY = 'sa_teacher_info';

export function getStoredToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token) {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearStoredToken() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

// verify-code returns { id, name } once; stored alongside the token so a
// page reload can restore "Welcome, {name}" without re-decoding the JWT
// (the JWT itself carries only `sub`, per ADR-008 §4.1).
export function getStoredTeacher() {
  const raw = localStorage.getItem(TEACHER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setStoredTeacher(teacher) {
  localStorage.setItem(TEACHER_STORAGE_KEY, JSON.stringify(teacher));
}

export function clearStoredTeacher() {
  localStorage.removeItem(TEACHER_STORAGE_KEY);
}

export function logout() {
  clearStoredToken();
  clearStoredTeacher();
}

export { ApiError };
