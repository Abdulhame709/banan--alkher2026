import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import App from './App';
import { AuthProvider } from './lib/auth';
import { RealtimeProvider } from './lib/realtime';
import { ToastProvider } from './lib/toast';
import './index.css';

if (Capacitor.isNativePlatform()) {
  void NativeApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void NativeApp.exitApp();
  });
}

// When a new service worker takes control, reload once so the user never keeps
// seeing an old cached build after a deployment.
if ('serviceWorker' in navigator && !Capacitor.isNativePlatform()) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <ToastProvider>
        <AuthProvider>
          <RealtimeProvider>
            <App />
          </RealtimeProvider>
        </AuthProvider>
      </ToastProvider>
    </HashRouter>
  </StrictMode>
);
