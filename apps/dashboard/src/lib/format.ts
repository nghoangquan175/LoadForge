const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const fmtCompact = (n: number) => compact.format(n);

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

// All times are shown in Vietnam time, 24h, day/month order.
export const TIME_ZONE = 'Asia/Ho_Chi_Minh';
export const TZ_LABEL = 'GMT+7';

const parts = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hourCycle: 'h23', ...opts });

const hms = parts({ hour: '2-digit', minute: '2-digit', second: '2-digit' });
const hm = parts({ hour: '2-digit', minute: '2-digit' });
const dm = parts({ day: '2-digit', month: '2-digit' });
const dmy = parts({ day: '2-digit', month: '2-digit', year: 'numeric' });

/** 08:27:00 */
export const fmtTime = (t: number) => hms.format(t);

/** 08:27 */
export const fmtHourMinute = (t: number) => hm.format(t);

/** 30/09 08:27:00 */
export const fmtDayTime = (t: number) => `${dm.format(t)} ${hms.format(t)}`;

/** 30/09/2026 08:27:00 */
export const fmtDateTime = (t: number) => `${dmy.format(t)} ${hms.format(t)}`;

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

export const last = <T,>(xs: T[]): T | undefined => xs[xs.length - 1];
