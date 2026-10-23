import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  BarChart3,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  HandCoins,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  ReceiptText,
  ScrollText,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { initials, ROLE_LABELS } from '../lib/format';
import { BrandBlock, FundLogo } from './Logo';
import { NotificationBell } from './NotificationBell';
import { ChangePasswordModal } from './ChangePasswordModal';
import type { Role } from '../types';

interface NavItem {
  path: string;
  label: string;
  shortLabel?: string;
  icon: ReactNode;
  show: boolean;
  section?: string;
}

const PAGE_TITLES: Record<string, string> = {
  '/': 'لوحة التحكم',
  '/members': 'إدارة الأعضاء',
  '/subscriptions': 'الاستحقاقات الشهرية',
  '/receipts': 'سندات القبض والتبرعات',
  '/expenses': 'طلبات الصرف والاعتمادات',
  '/reports': 'التقارير المالية',
  '/admin': 'إدارة النظام والإعدادات',
  '/users': 'إدارة المستخدمين والصلاحيات',
  '/settings': 'إعدادات الصندوق',
  '/audit': 'سجل الرقابة والتدقيق',
};

export function Layout() {
  const { user, capabilities, logout, settings } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('banan:sidebar') === '1');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDrawerOpen(false);
    setUserMenu(false);
  }, [location.pathname]);

  useEffect(() => {
    localStorage.setItem('banan:sidebar', collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
        setUserMenu(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!userMenu) return;
    const onClick = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenu(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [userMenu]);

  if (!user || !capabilities) return null;

  const isInternal = user.role !== 'member';
  const navItems: NavItem[] = [
    {
      path: '/',
      label: 'لوحة التحكم',
      shortLabel: 'الرئيسية',
      icon: <LayoutDashboard size={20} />,
      show: true,
    },
    {
      path: '/members',
      label: 'الأعضاء',
      icon: <Users size={20} />,
      show: isInternal,
    },
    {
      path: '/subscriptions',
      label: 'الاستحقاقات الشهرية',
      shortLabel: 'الاستحقاقات',
      icon: <CalendarClock size={20} />,
      show: isInternal,
    },
    {
      path: '/receipts',
      label: 'سندات القبض والتبرعات',
      shortLabel: 'السندات',
      icon: <ReceiptText size={20} />,
      show: capabilities.manageReceipts || user.role === 'board_member',
    },
    {
      path: '/expenses',
      label: 'طلبات الصرف والاعتمادات',
      shortLabel: 'الصرف',
      icon: <HandCoins size={20} />,
      show: isInternal,
    },
    {
      path: '/reports',
      label: 'التقارير المالية',
      shortLabel: 'التقارير',
      icon: <BarChart3 size={20} />,
      show: capabilities.viewReports,
    },
    {
      path: '/users',
      label: 'المستخدمون والصلاحيات',
      icon: <UserCog size={20} />,
      show: capabilities.admin,
      section: 'الإدارة',
    },
    {
      path: '/settings',
      label: 'إعدادات الصندوق',
      icon: <Settings size={20} />,
      show: capabilities.admin,
      section: 'الإدارة',
    },
    {
      path: '/audit',
      label: 'سجل الرقابة والتدقيق',
      icon: <ScrollText size={20} />,
      show: capabilities.viewAudit,
      section: 'الإدارة',
    },
  ];

  const visible = navItems.filter((item) => item.show);
  const mobileItems = visible
    .filter((item) => !item.section)
    .slice(0, 4);
  const pageTitle =
    PAGE_TITLES[location.pathname] ??
    (location.pathname.startsWith('/members') ? 'كشف حساب عضو' : 'صندوق بنان الخير');

  function NavContent({ compact }: { compact: boolean }) {
    let lastSection = '';
    return (
      <nav className="sidebar-nav">
        {visible.map((item) => {
          const showSection = item.section && item.section !== lastSection;
          if (item.section) lastSection = item.section;
          return (
            <div key={item.path}>
              {showSection && !compact && <span className="nav-section-label">{item.section}</span>}
              <NavLink
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                title={compact ? item.label : undefined}
              >
                <span className="nav-icon">{item.icon}</span>
                {!compact && <span className="nav-label">{item.label}</span>}
              </NavLink>
            </div>
          );
        })}
      </nav>
    );
  }

  function SidebarBody({ compact = false, mobile = false }: { compact?: boolean; mobile?: boolean }) {
    return (
      <aside className={`sidebar ${compact ? 'collapsed' : ''} ${mobile ? 'sidebar-mobile' : ''}`}>
        <div className="sidebar-head">
          {compact ? (
            <FundLogo size={38} />
          ) : (
            <div className="sidebar-brand">
              <BrandBlock compact />
            </div>
          )}
          {!mobile && (
            <button
              type="button"
              className="icon-btn sidebar-collapse"
              onClick={() => setCollapsed((value) => !value)}
              aria-label={collapsed ? 'توسيع القائمة' : 'طي القائمة'}
            >
              {collapsed ? <ChevronLeft size={17} /> : <ChevronRight size={17} />}
            </button>
          )}
          {mobile && (
            <button type="button" className="icon-btn" onClick={() => setDrawerOpen(false)} aria-label="إغلاق">
              <X size={20} />
            </button>
          )}
        </div>

        {!compact && (
          <div className="sidebar-fund-meta">
            <span className="live-dot" />
            <span>النظام المحاسبي — {settings?.currency ?? 'ريال يمني'}</span>
          </div>
        )}

        <NavContent compact={compact} />

        <div className="sidebar-foot">
          {!compact ? (
            <>
              <div className="sidebar-user">
                <span className="avatar avatar-sm">{initials(user!.full_name)}</span>
                <div className="sidebar-user-text">
                  <strong>{user!.full_name}</strong>
                  <span>{ROLE_LABELS[user!.role]}</span>
                </div>
              </div>
              <button type="button" className="logout-btn" onClick={logout}>
                <LogOut size={17} />
                <span>تسجيل الخروج</span>
              </button>
              <div className="sidebar-credit">صندوق بنان الخير للبنيان</div>
            </>
          ) : (
            <button type="button" className="icon-btn" onClick={logout} aria-label="تسجيل الخروج" title="تسجيل الخروج">
              <LogOut size={18} />
            </button>
          )}
        </div>
      </aside>
    );
  }

  return (
    <div className={`app-shell ${collapsed ? 'sidebar-is-collapsed' : ''}`}>
      <div className="desktop-sidebar">
        <SidebarBody compact={collapsed} />
      </div>

      {drawerOpen && (
        <div className="drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && setDrawerOpen(false)}>
          <div className="drawer-panel">
            <SidebarBody mobile />
          </div>
        </div>
      )}

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-start">
            <button type="button" className="icon-btn mobile-menu-btn" onClick={() => setDrawerOpen(true)} aria-label="فتح القائمة">
              <Menu size={22} />
            </button>
            <div className="topbar-logo-mobile">
              <FundLogo size={32} />
            </div>
            <div className="topbar-title">
              <span className="topbar-eyebrow">صندوق بنان الخير للبنيان</span>
              <h1>{pageTitle}</h1>
            </div>
          </div>
          <div className="topbar-actions">
            {isInternal && (
              <NavLink to="/expenses" className="topbar-quick" title="مركز الاعتمادات">
                <ShieldCheck size={18} />
                <span>مركز الاعتمادات</span>
              </NavLink>
            )}
            <NotificationBell />
            <div className="user-menu" ref={userMenuRef}>
              <button
                type="button"
                className="user-chip"
                onClick={() => setUserMenu((value) => !value)}
                aria-expanded={userMenu}
              >
                <span className="avatar">{initials(user.full_name)}</span>
                <span className="user-chip-text">
                  <strong>{user.full_name}</strong>
                  <small>{ROLE_LABELS[user.role]}</small>
                </span>
                <ChevronLeft size={15} className="user-chip-chevron" />
              </button>
              {userMenu && (
                <div className="user-dropdown">
                  <div className="user-dropdown-head">
                    <span className="avatar avatar-lg">{initials(user.full_name)}</span>
                    <div>
                      <strong>{user.full_name}</strong>
                      <span>{user.email}</span>
                      <em>{ROLE_LABELS[user.role]}</em>
                    </div>
                  </div>
                  {capabilities.admin && (
                    <>
                      <NavLink to="/users" className="dropdown-link"><UserCog size={17} /> المستخدمون والصلاحيات</NavLink>
                      <NavLink to="/settings" className="dropdown-link"><Settings size={17} /> إعدادات الصندوق</NavLink>
                    </>
                  )}
                  {capabilities.viewAudit && (
                    <NavLink to="/audit" className="dropdown-link"><ScrollText size={17} /> سجل التدقيق</NavLink>
                  )}
                  <button
                    type="button"
                    className="dropdown-link"
                    onClick={() => {
                      setUserMenu(false);
                      setPasswordOpen(true);
                    }}
                  >
                    <KeyRound size={17} /> تغيير كلمة المرور
                  </button>
                  <button type="button" className="dropdown-link danger" onClick={logout}>
                    <LogOut size={17} /> تسجيل الخروج
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="app-content">
          <Outlet />
        </main>
      </div>

      <nav className="bottom-nav" aria-label="التنقل الرئيسي">
        {mobileItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
          >
            {item.icon}
            <span>{item.shortLabel ?? item.label}</span>
          </NavLink>
        ))}
        <button type="button" className="bottom-nav-item" onClick={() => setDrawerOpen(true)}>
          <MoreHorizontal size={21} />
          <span>المزيد</span>
        </button>
      </nav>

      {passwordOpen && (
        <ChangePasswordModal email={user.email} onClose={() => setPasswordOpen(false)} />
      )}
    </div>
  );
}

export function roleLabel(role: Role) {
  return ROLE_LABELS[role] ?? role;
}
