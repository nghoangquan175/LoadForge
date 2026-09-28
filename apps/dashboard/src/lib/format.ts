const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const fmtCompact = (n: number) => compact.format(n);

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

/** HH:MM:SS in UTC */
export const fmtTime = (t: number) => new Date(t).toISOString().slice(11, 19);

/** HH:MM in UTC */
export const fmtClock = (t: number) => new Date(t).toISOString().slice(11, 16);

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
