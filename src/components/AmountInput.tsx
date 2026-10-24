import { useMemo } from 'react';

/**
 * Integer-only money input with thousands separators.
 * The parent stores raw digits (e.g. "1000"); the field displays "1,000".
 * Decimal points and minus signs are rejected, never rounded.
 */
export function AmountInput({
  value,
  onChange,
  placeholder = '0',
  disabled,
  required,
  className = '',
  id,
  ariaLabel,
}: {
  value: string;
  onChange: (rawDigits: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
  ariaLabel?: string;
}) {
  const display = useMemo(() => {
    const digits = String(value ?? '').replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
    if (!digits) return '';
    return Number(digits).toLocaleString('en-US');
  }, [value]);

  return (
    <input
      id={id}
      className={`input amount-input ${className}`}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      dir="ltr"
      value={display}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      aria-label={ariaLabel}
      onChange={(event) => {
        const raw = event.target.value;
        // Reject decimal points, minus signs, letters and any other character
        // instead of silently turning "1000.01" into "100001". Restore the
        // displayed value immediately because no state update will happen.
        if (/[^\d,\s]/.test(raw)) {
          event.currentTarget.value = display;
          return;
        }
        const digits = raw.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
        onChange(digits);
      }}
    />
  );
}

export function parseAmount(value: string | number | null | undefined): number {
  const text = String(value ?? '').replace(/,/g, '').trim();
  if (!/^\d+$/.test(text)) return 0;
  const number = Number(text);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}
