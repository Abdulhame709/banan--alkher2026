import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';
import type { Capabilities, PublicSettings, SessionPayload, User } from '../types';

interface AuthContextValue {
  user: User | null;
  capabilities: Capabilities | null;
  settings: PublicSettings | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (data: {
    full_name: string;
    email: string;
    password: string;
    phone?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  applySession: (payload: SessionPayload) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const applySession = useCallback((payload: SessionPayload) => {
    setUser(payload.user);
    setCapabilities(payload.capabilities);
    setSettings(payload.settings);
  }, []);

  const clear = useCallback(() => {
    setUser(null);
    setCapabilities(null);
    setSettings(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const payload = await api.get<SessionPayload>('/auth/me');
      applySession(payload);
    } catch {
      clear();
    }
  }, [applySession, clear]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const payload = await api.get<SessionPayload>('/auth/me');
        if (active) applySession(payload);
      } catch {
        if (active) clear();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [applySession, clear]);

  useEffect(() => {
    const onUnauthorized = () => clear();
    window.addEventListener('banan:unauthorized', onUnauthorized);
    return () => window.removeEventListener('banan:unauthorized', onUnauthorized);
  }, [clear]);

  const login = useCallback(
    async (email: string, password: string) => {
      const payload = await api.post<SessionPayload>('/auth/login', { email, password });
      applySession(payload);
    },
    [applySession]
  );

  const signup = useCallback(
    async (data: { full_name: string; email: string; password: string; phone?: string }) => {
      const payload = await api.post<SessionPayload>('/auth/signup', data);
      applySession(payload);
    },
    [applySession]
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore network failures during logout */
    }
    clear();
  }, [clear]);

  const value = useMemo(
    () => ({
      user,
      capabilities,
      settings,
      loading,
      login,
      signup,
      logout,
      refresh,
      applySession,
    }),
    [user, capabilities, settings, loading, login, signup, logout, refresh, applySession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
