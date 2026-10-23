import { supabase } from './supabase';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface RequestOptions {
  method?: Method;
  body?: unknown;
  signal?: AbortSignal;
  raw?: boolean;
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
// Keep the Edge Function next to the database (Sydney). Without this the
// platform runs it in the region closest to the visitor and every SQL query
// pays a cross-region round trip.
const EDGE_REGION = 'ap-southeast-2';
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

async function authHeaders(): Promise<Record<string, string>> {
  if (!accessToken) {
    const { data } = await supabase.auth.getSession();
    accessToken = data.session?.access_token ?? null;
  }
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

function notifyUnauthorized() {
  window.dispatchEvent(new CustomEvent('banan:unauthorized'));
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = await authHeaders();
  headers['x-region'] = EDGE_REGION;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) throw new ApiError('تعذر الاتصال بالخادم', response.status);
    return (await response.text()) as T;
  }

  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) notifyUnauthorized();
    throw new ApiError(data?.error ?? 'حدث خطأ غير متوقع', response.status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export async function uploadFile(file: File, kind: 'document' | 'logo' = 'document') {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${API_BASE}${kind === 'logo' ? '/uploads/logo' : '/uploads'}`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'x-region': EDGE_REGION },
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) notifyUnauthorized();
    throw new ApiError(data?.error ?? 'تعذر رفع الملف', response.status);
  }
  return data as { file: string; name: string; size: number; mime: string };
}

export async function downloadCsv(path: string, fallbackName: string) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { ...(await authHeaders()), 'x-region': EDGE_REGION },
  });
  if (!response.ok) {
    if (response.status === 401) notifyUnauthorized();
    const data = await response.json().catch(() => ({}));
    throw new ApiError(data?.error ?? 'تعذر تصدير التقرير', response.status);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function fileUrl(filename: string | null | undefined) {
  if (!filename) return '';
  if (filename.startsWith('http')) return filename;
  const base = API_BASE.startsWith('http') ? API_BASE : `${window.location.origin}${API_BASE}`;
  const params = new URLSearchParams();
  if (accessToken) params.set('token', accessToken);
  params.set('forceFunctionRegion', EDGE_REGION);
  return `${base}/files/${encodeURIComponent(filename)}?${params.toString()}`;
}

export function apiErrorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.name === 'AbortError') return '';
  return 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى';
}
