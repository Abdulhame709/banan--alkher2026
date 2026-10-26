const FALLBACK_PUBLIC_URL = 'https://walid19-89.github.io/banan--alkher2026';

export function publicAppUrl() {
  const configured = String(import.meta.env.VITE_PUBLIC_APP_URL ?? '').trim();

  // The APK runs from capacitor://localhost, so it must use the configured
  // public URL. Local browser development also uses the public fallback.
  if (window.location.protocol === 'capacitor:') {
    return (configured || FALLBACK_PUBLIC_URL).replace(/\/+$/, '');
  }
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return FALLBACK_PUBLIC_URL;
  }

  // On the web, derive the URL from the host that is actually serving the app.
  // This keeps QR/verification links on GitHub Pages, the Worker, or any other
  // mirror without rebuilding for each domain.
  const path = window.location.pathname;
  const basePath = path.endsWith('/') ? path : path.replace(/\/[^/]*$/, '/');
  return `${window.location.origin}${basePath}`.replace(/\/+$/, '');
}

export function verifyDocumentUrl(type: 'receipt' | 'expense', token: string) {
  return `${publicAppUrl()}/#/verify/${type}/${token}`;
}
