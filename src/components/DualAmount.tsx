import { useAuth } from '../lib/auth';
import { money, moneyIn, secondaryAmount } from '../lib/format';

/**
 * Shows an amount in the primary currency and, when the second currency is
 * enabled in settings, its equivalent below/beside it.
 */
export function DualAmount({
  value,
  currency = true,
  className = '',
  inline = false,
  decimals = false,
}: {
  value: number | null | undefined;
  currency?: boolean;
  className?: string;
  inline?: boolean;
  decimals?: boolean;
}) {
  const { settings } = useAuth();
  const rate = Number(settings?.exchange_rate) || 0;
  const enabled = Boolean(settings?.secondary_enabled) && rate > 0;
  const primary = decimals
    ? moneyIn(value, settings?.currency ?? 'ريال يمني', currency)
    : money(value, currency);

  if (!enabled) {
    return <span className={`dual-amount ${className}`.trim()}>{primary}</span>;
  }

  const secondary = moneyIn(
    secondaryAmount(value, rate),
    settings?.secondary_currency || 'ريال سعودي',
    currency
  );

  return (
    <span className={`dual-amount ${inline ? 'dual-inline' : ''} ${className}`.trim()}>
      <span className="dual-primary">{primary}</span>
      <small className="dual-secondary">≈ {secondary}</small>
    </span>
  );
}
