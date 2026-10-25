const FALLBACK_PUBLIC_URL = 'https://walid19-89.github.io/banan--alkher2026';

export function publicAppUrl() {
  const configured = String(import.meta.env.VITE_PUBLIC_APP_URL ?? '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (window.location.protocol === 'capacitor:' || window.location.hostname === 'localhost') {
    return FALLBACK_PUBLIC_URL;
  }
  const base = import.meta.env.BASE_URL || '/';
  return `${window.location.origin}${base}`.replace(/\/+$/, '');
}

export function verifyDocumentUrl(type: 'receipt' | 'expense', token: string) {
  return `${publicAppUrl()}/#/verify/${type}/${token}`;
}
