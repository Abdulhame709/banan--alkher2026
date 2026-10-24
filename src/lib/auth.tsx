import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, setAccessToken } from './api';
import { supabase } from './supabase';
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
  }) => Promise<{ message: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  applySession: (payload: SessionPayload) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function friendlyAuthError(message: string) {
  const text = message.toLowerCase();
  if (text.includes('invalid login credentials')) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  if (text.includes('email not confirmed')) return 'يرجى تأكيد البريد الإلكتروني أولاً ثم تسجيل الدخول';
  if (text.includes('user already registered')) return 'يوجد حساب مسجل بهذا البريد الإلكتروني';
  if (text.includes('password should be at least')) return 'كلمة المرور يجب أن تكون 8 أحرف على الأقل';
  if (text.includes('unable to validate email')) return 'البريد الإلكتروني غير صالح';
  if (text.includes('signups not allowed')) return 'التسجيل الذاتي مغلق حالياً. تواصل مع مدير النظام';
  return message || 'تعذر إتمام العملية';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
      const payload = await api.get<SessionPayload>('/auth/me', AbortSignal.timeout(15000));
      if (mounted.current) applySession(payload);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        const { data } = await supabase.auth.refreshSession();
        if (data.session) {
          setAccessToken(data.session.access_token);
          try {
            const payload = await api.get<SessionPayload>('/auth/me', AbortSignal.timeout(15000));
            if (mounted.current) applySession(payload);
            return;
          } catch {
            /* fall through to clear */
          }
        }
      }
      if (mounted.current) clear();
    }
  }, [applySession, clear]);

  useEffect(() => {
    let active = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setAccessToken(data.session?.access_token ?? null);
      if (data.session) await refresh();
      else clear();
      if (active) setLoading(false);
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      setAccessToken(session?.access_token ?? null);
      if (event === 'SIGNED_OUT' || !session) {
        clear();
      }
      // login()/signup() call refresh() explicitly. Refreshing here too caused
      // two simultaneous /auth/me calls (and a long splash) on every reload.
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [refresh, clear]);

  useEffect(() => {
    const onUnauthorized = () => {
      setAccessToken(null);
      clear();
    };
    window.addEventListener('banan:unauthorized', onUnauthorized);
    return () => window.removeEventListener('banan:unauthorized', onUnauthorized);
  }, [clear]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new ApiError(friendlyAuthError(error.message), 401);
      const { data: sessionData } = await supabase.auth.getSession();
      setAccessToken(sessionData.session?.access_token ?? null);
      try {
        const payload = await api.get<SessionPayload>('/auth/me', AbortSignal.timeout(15000));
        if (mounted.current) applySession(payload);
      } catch (error) {
        await supabase.auth.signOut().catch(() => undefined);
        setAccessToken(null);
        if (mounted.current) clear();
        throw error;
      }
    },
    [applySession, clear]
  );

  const signup = useCallback(
    async (data: { full_name: string; email: string; password: string; phone?: string }) => {
      const { data: result, error } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            full_name: data.full_name,
            phone: data.phone || null,
          },
        },
      });
      if (error) throw new ApiError(friendlyAuthError(error.message), 400);
      // Signup creates a pending account. Never leave the new user signed in
      // before an administrator approves the request.
      if (result.session) await supabase.auth.signOut().catch(() => undefined);
      setAccessToken(null);
      clear();
      return {
        message: 'تم إرسال طلب التسجيل بنجاح. سيبقى الحساب معطلاً حتى توافق الإدارة عليه.',
      };
    },
    [clear]
  );

  const logout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      setAccessToken(null);
      clear();
    }
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
