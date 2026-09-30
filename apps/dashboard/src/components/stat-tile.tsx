import type { ReactNode } from 'react';
import type { MetricPoint } from '@/lib/types';

export type Severity = 'ok' | 'warn' | 'crit';

const SEVERITY_TEXT: Record<Severity, string> = {
  ok: 'text-accent',
  warn: 'text-warn',
  crit: 'text-crit',
};

const SEVERITY_ICON: Record<Severity, string> = {
  ok: '●',
  warn: '▲',
  crit: '✖',
};

interface StatTileProps {
  label: ReactNode;
  value: string;
  unit?: string;
  /** CSS color of the metric's chart line, ties tile to chart */
  color: string;
  note: string;
  severity: Severity;
  trend?: MetricPoint[];
}

/** Tiny trend line; the full chart below carries axes and hover. */
function Sparkline({ points, color }: { points: MetricPoint[]; color: string }) {
  if (points.length < 2) return null;
  const vs = points.map((p) => p.v);
  const lo = Math.min(...vs);
  const span = Math.max(...vs) - lo || 1;
  const d = vs
    .map((v, i) => `${i ? 'L' : 'M'}${((i / (vs.length - 1)) * 100).toFixed(2)},${(28 - ((v - lo) / span) * 26 - 1).toFixed(2)}`)
    .join('');
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-7 w-full" aria-hidden>
      <path d={d} fill="none" stroke={color} strokeOpacity={0.8} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export function StatTile({ label, value, unit, color, note, severity, trend }: StatTileProps) {
  return (
    <div className="brackets relative flex min-w-0 flex-col justify-between gap-3 overflow-hidden border border-line bg-panel/90 px-4 py-3">
      <div className="absolute inset-y-0 left-0 w-0.5" style={{ background: color }} />
      <div>
        <div className="text-[10px] tracking-[0.18em] text-muted uppercase">{label}</div>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className="text-3xl font-semibold text-ink">{value}</span>
          {unit && <span className="text-xs text-ink-2">{unit}</span>}
        </div>
        <div className={`mt-1 truncate text-[11px] ${SEVERITY_TEXT[severity]}`}>
          <span aria-hidden>{SEVERITY_ICON[severity]} </span>
          {note}
        </div>
      </div>
      {trend && <Sparkline points={trend} color={color} />}
    </div>
  );
}
