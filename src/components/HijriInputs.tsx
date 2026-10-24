import { useMemo } from 'react';
import {
  HIJRI_MONTHS,
  fromHijri,
  hijriMonthLabel,
  hijriMonthOptions,
  hijriYearOptions,
  parseHijriMonthKey,
  toHijri,
} from '../lib/hijri';
import { Select } from './ui';

/** Gregorian ISO date is stored in the API; the user edits it as Hijri. */
export function HijriDateInput({
  value,
  onChange,
  disabled,
  required,
  id,
}: {
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  required?: boolean;
  id?: string;
}) {
  const hijri = useMemo(() => toHijri(value), [value]);
  const years = useMemo(() => hijriYearOptions(hijri.year || undefined), [hijri.year]);
  const dayCount = 30;

  function update(nextYear: number, nextMonth: number, nextDay: number) {
    const iso = fromHijri(nextYear, nextMonth, nextDay);
    if (iso) onChange(iso);
  }

  return (
    <div className="hijri-date-input" id={id} dir="rtl">
      <Select
        value={hijri.day || 1}
        disabled={disabled}
        required={required}
        aria-label="اليوم الهجري"
        onChange={(event) => update(hijri.year, hijri.month, Number(event.target.value))}
      >
        {Array.from({ length: dayCount }, (_, index) => index + 1).map((day) => (
          <option key={day} value={day}>{day}</option>
        ))}
      </Select>
      <Select
        value={hijri.month || 1}
        disabled={disabled}
        required={required}
        aria-label="الشهر الهجري"
        onChange={(event) => update(hijri.year, Number(event.target.value), hijri.day || 1)}
      >
        {HIJRI_MONTHS.map((month, index) => (
          <option key={month} value={index + 1}>{month}</option>
        ))}
      </Select>
      <Select
        value={hijri.year || new Date().getFullYear()}
        disabled={disabled}
        required={required}
        aria-label="السنة الهجرية"
        onChange={(event) => update(Number(event.target.value), hijri.month || 1, hijri.day || 1)}
      >
        {years.map((year) => (
          <option key={year} value={year}>{year}</option>
        ))}
      </Select>
      <span className="hijri-date-suffix">هـ</span>
    </div>
  );
}

/** Hijri month picker used for dues and report ranges. */
export function HijriMonthInput({
  value,
  onChange,
  disabled,
  required,
  back = 36,
  forward = 6,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  back?: number;
  forward?: number;
  id?: string;
}) {
  const options = useMemo(() => hijriMonthOptions(back, forward), [back, forward]);
  const current = parseHijriMonthKey(value);
  const missing = value && !options.some((option) => option.value === value);
  return (
    <div className="hijri-month-input" id={id}>
      <Select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        required={required}
        aria-label="الشهر الهجري"
      >
        {missing && <option value={value}>{hijriMonthLabel(value)}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </Select>
      {current && <span className="hijri-date-suffix">هـ</span>}
    </div>
  );
}
