'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useSteadyScroll, useTween, type ViewMove } from '@/lib/motion';
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
  /** Full history length, so a short series is drawn to the same time scale. */
  historyMs?: number;
}

/** Sparklines never pan: always following live. */
const FOLLOW: ViewMove = { snap: false };

/** Tiny trend line; the full chart below carries axes and hover. Slides left as new points arrive. */
function Sparkline({ points, color, historyMs }: { points: MetricPoint[]; color: string; historyMs?: number }) {
  const pathRef = useRef<SVGPathElement>(null);
  const first = points[0]?.t ?? 0;
  const newest = points[points.length - 1]?.t ?? 1;
  const vs = points.map((p) => p.v);
  const target: Record<string, number> = { span: historyMs || newest - first || 1, lo: Math.min(...vs), hi: Math.max(...vs) };
  for (const p of points) target[`v${p.t}`] = p.v;
  const get = useTween(target);
  const span = get('span');

  // Drawn as if the view ended at the newest point; scrolling only shifts it.
  const shift = (edge: number) =>
    pathRef.current?.setAttribute('transform', `translate(${(((newest - edge) / span) * 100).toFixed(3)},0)`);
  const edge = useSteadyScroll(newest, true, FOLLOW, shift);
  useLayoutEffect(() => {
    shift(edge());
  });
  if (points.length < 2) return null;

  const lo = get('lo');
  const range = get('hi') - lo || 1;
  // By time, not by index: points outside the box are clipped by the svg.
  const d = points
    .map((p, i) => `${i ? 'L' : 'M'}${(((p.t - (newest - span)) / span) * 100).toFixed(2)},${(28 - ((get(`v${p.t}`) - lo) / range) * 26 - 1).toFixed(2)}`)
    .join('');
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-7 w-full" aria-hidden>
      <path ref={pathRef} d={d} fill="none" stroke={color} strokeOpacity={0.8} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export function StatTile({ label, value, unit, color, note, severity, trend, historyMs }: StatTileProps) {
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
      {trend && <Sparkline points={trend} color={color} historyMs={historyMs} />}
    </div>
  );
}
