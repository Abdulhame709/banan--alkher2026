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
import { api } from './api';
import { useAuth } from './auth';
import { supabase } from './supabase';
import { useToast } from './toast';
import type { FundNotification } from '../types';

interface RealtimeContextValue {
  /** Increments after a database change; pages include it in their load effect. */
  version: number;
  notifications: FundNotification[];
  unread: number;
  loading: boolean;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const toast = useToast();
  const userId = user?.id ?? null;
  const [version, setVersion] = useState(0);
  const [notifications, setNotifications] = useState<FundNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const bumpTimer = useRef<number | null>(null);
  const channelSuffix = useRef(Math.random().toString(36).slice(2)).current;

  const scheduleVersionBump = useCallback(() => {
    if (bumpTimer.current) window.clearTimeout(bumpTimer.current);
    bumpTimer.current = window.setTimeout(() => {
      bumpTimer.current = null;
      setVersion((value) => value + 1);
    }, 350);
  }, []);

  const refreshNotifications = useCallback(async () => {
    if (!userId) {
      setNotifications([]);
      setUnread(0);
      return;
    }
    setLoading(true);
    try {
      const payload = await api.get<{ notifications: FundNotification[]; unread: number }>(
        '/notifications'
      );
      setNotifications(payload.notifications);
      setUnread(payload.unread);
    } catch {
      /* A notification failure must never block the main screen. */
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      setUnread(0);
      return;
    }

    void refreshNotifications();

    const channel = supabase
      .channel(`fund-realtime-${userId}-${channelSuffix}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'fund_events' },
        () => scheduleVersionBump()
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'fund_notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const notification = payload.new as FundNotification;
          setNotifications((current) => [notification, ...current].slice(0, 50));
          setUnread((current) => current + 1);
          toast.info(notification.title);
          scheduleVersionBump();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'fund_notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => void refreshNotifications()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, channelSuffix, refreshNotifications, scheduleVersionBump, toast]);

  useEffect(() => {
    if (!userId) return;
    const refreshOnFocus = () => void refreshNotifications();
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') void refreshNotifications();
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnVisible);
    const interval = window.setInterval(refreshOnFocus, 60_000);
    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnVisible);
      window.clearInterval(interval);
    };
  }, [userId, refreshNotifications]);

  useEffect(
    () => () => {
      if (bumpTimer.current) window.clearTimeout(bumpTimer.current);
    },
    []
  );

  const markRead = useCallback(
    async (id: string) => {
      const target = notifications.find((item) => item.id === id);
      if (target?.read_at) return;
      setNotifications((current) =>
        current.map((item) =>
          item.id === id ? { ...item, read_at: new Date().toISOString() } : item
        )
      );
      setUnread((current) => Math.max(0, current - 1));
      try {
        await api.post(`/notifications/${id}/read`);
      } catch {
        void refreshNotifications();
      }
    },
    [notifications, refreshNotifications]
  );

  const markAllRead = useCallback(async () => {
    setNotifications((current) =>
      current.map((item) => ({
        ...item,
        read_at: item.read_at ?? new Date().toISOString(),
      }))
    );
    setUnread(0);
    try {
      await api.post('/notifications/read-all');
    } catch {
      void refreshNotifications();
    }
  }, [refreshNotifications]);

  const value = useMemo(
    () => ({
      version,
      notifications,
      unread,
      loading,
      markRead,
      markAllRead,
      refreshNotifications,
    }),
    [version, notifications, unread, loading, markRead, markAllRead, refreshNotifications]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error('useRealtime must be used inside RealtimeProvider');
  return context;
}

export function useRealtimeVersion() {
  return useRealtime().version;
}
