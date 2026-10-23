import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  CheckCheck,
  CheckCircle2,
  HandCoins,
  Info,
  Wallet,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDateTime, formatNumber } from '../lib/format';
import { useRealtime } from '../lib/realtime';
import type { FundNotification } from '../types';

const TYPE_ICONS: Record<string, LucideIcon> = {
  expense_pending: HandCoins,
  expense_approved: CheckCircle2,
  expense_paid: Wallet,
  expense_rejected: XCircle,
};

const TYPE_TONES: Record<string, string> = {
  expense_pending: 'gold',
  expense_approved: 'emerald',
  expense_paid: 'emerald',
  expense_rejected: 'danger',
};

export function NotificationBell() {
  const navigate = useNavigate();
  const { notifications, unread, loading, markRead, markAllRead } = useRealtime();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function openNotification(notification: FundNotification) {
    void markRead(notification.id);
    setOpen(false);
    if (notification.link) navigate(notification.link);
  }

  const badge = unread > 99 ? '99+' : formatNumber(unread);

  return (
    <div className="notification-menu" ref={wrapperRef}>
      <button
        type="button"
        className={`icon-btn notification-btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-label="الإشعارات"
        aria-expanded={open}
        title="الإشعارات"
      >
        <Bell size={20} />
        {unread > 0 && <span className="notification-badge">{badge}</span>}
      </button>

      {open && (
        <div className="notification-dropdown">
          <div className="notification-head">
            <div>
              <strong>الإشعارات</strong>
              <small>{unread > 0 ? `${formatNumber(unread)} غير مقروء` : 'لا توجد إشعارات جديدة'}</small>
            </div>
            {unread > 0 && (
              <button type="button" className="notification-read-all" onClick={() => void markAllRead()}>
                <CheckCheck size={14} /> تعليم الكل كمقروء
              </button>
            )}
          </div>

          <div className="notification-list">
            {loading && notifications.length === 0 ? (
              <div className="notification-empty">
                <span className="spinner-sm" /> جارٍ تحميل الإشعارات…
              </div>
            ) : notifications.length === 0 ? (
              <div className="notification-empty">
                <Info size={18} /> لا توجد إشعارات بعد
              </div>
            ) : (
              notifications.map((notification) => {
                const Icon = TYPE_ICONS[notification.type] ?? Bell;
                const tone = TYPE_TONES[notification.type] ?? 'slate';
                return (
                  <button
                    type="button"
                    key={notification.id}
                    className={`notification-item${notification.read_at ? '' : ' is-unread'}`}
                    onClick={() => openNotification(notification)}
                  >
                    <span className={`notification-icon tone-${tone}`}>
                      <Icon size={18} />
                    </span>
                    <span className="notification-copy">
                      <strong>{notification.title}</strong>
                      {notification.body && <small>{notification.body}</small>}
                      <em>{formatDateTime(notification.created_at)}</em>
                    </span>
                    {!notification.read_at && <span className="notification-dot" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
