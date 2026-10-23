import { useAuth } from '../lib/auth';

export const FUND_NAME = 'صندوق بنان الخير للبنيان';
export const FUND_SUBTITLE = 'الغدير – مقبنة – تعز | النظام المحاسبي والإداري';

export function Emblem({ size = 48, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="شعار صندوق بنان الخير للبنيان"
    >
      <defs>
        <linearGradient id="emblem-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0a7a5a" />
          <stop offset="100%" stopColor="#044e39" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="url(#emblem-bg)" />
      <circle cx="50" cy="50" r="42.5" fill="none" stroke="#d97706" strokeWidth="1.6" opacity="0.85" />
      <path
        d="M50 20v38"
        stroke="#f6e3bf"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <path
        d="M50 43c-10.5 0-17.5-7.6-17.5-17.5C43 25.5 50 33.2 50 43Z"
        fill="#d97706"
        opacity="0.92"
      />
      <path
        d="M50 43c10.5 0 17.5-7.6 17.5-17.5C57 25.5 50 33.2 50 43Z"
        fill="#d97706"
        opacity="0.75"
      />
      <path
        d="M50 53c-8.8 0-14.8-6.4-14.8-14.8C44.2 38.2 50 44.6 50 53Z"
        fill="#f6e3bf"
        opacity="0.9"
      />
      <path
        d="M50 53c8.8 0 14.8-6.4 14.8-14.8C55.8 38.2 50 44.6 50 53Z"
        fill="#f6e3bf"
        opacity="0.7"
      />
      <path
        d="M28 59c7-4 14-4 22 0 8-4 15-4 22 0v5c-7-3-14-3-22 1-8-4-15-4-22-1v-5Z"
        fill="#f8faf9"
      />
      <path d="M32 73h36" stroke="#d97706" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M37 79h26" stroke="#f8faf9" strokeWidth="2.2" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

export function FundLogo({
  size = 52,
  className = '',
  src,
}: {
  size?: number;
  className?: string;
  src?: string | null;
}) {
  const { settings } = useAuth();
  const logo = src ?? settings?.logo_url ?? null;
  if (logo) {
    return (
      <img
        src={logo}
        alt="شعار الصندوق"
        width={size}
        height={size}
        className={`fund-logo-img ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return <Emblem size={size} className={className} />;
}

export function BrandBlock({
  compact = false,
  light = false,
}: {
  compact?: boolean;
  light?: boolean;
}) {
  const { settings } = useAuth();
  return (
    <div className={`brand-block ${compact ? 'brand-compact' : ''} ${light ? 'brand-light' : ''}`}>
      <FundLogo size={compact ? 38 : 46} />
      <div className="brand-text">
        <strong>{settings?.fund_name ?? FUND_NAME}</strong>
        {!compact && <span>{FUND_SUBTITLE}</span>}
      </div>
    </div>
  );
}
