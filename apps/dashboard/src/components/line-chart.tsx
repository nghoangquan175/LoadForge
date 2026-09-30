'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { fmtDateTime, fmtHourMinute, fmtTime } from '@/lib/format';
import type { MetricPoint } from '@/lib/types';

interface LineChartProps {
  points: MetricPoint[];
  /** CSS color, e.g. var(--color-accent) */
  color: string;
  label: string;
  format: (v: number) => string;
  /** fixed top of the y axis, otherwise a rounded max of the data */
  yMax?: number;
  threshold?: { value: number; label: string };
  height?: number;
}

const PAD = { l: 40, r: 10, t: 10, b: 22 };

/** Smallest 1/2/2.5/5 x 10^k that is >= v. */
function niceMax(v: number): number {
  if (v <= 1) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

function shortNum(v: number): string {
  if (v >= 1000) return `${Math.round(v / 100) / 10}k`;
  return String(Math.round(v * 10) / 10);
}

export function LineChart({ points, color, label, format, yMax, threshold, height = 150 }: LineChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const gradientId = useId();
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const w = Math.max(width - PAD.l - PAD.r, 1);
  const h = height - PAD.t - PAD.b;
  const ready = width > 0 && points.length > 1;

  const t0 = points[0]?.t ?? 0;
  const t1 = points[points.length - 1]?.t ?? 1;
  const top = yMax ?? niceMax(Math.max(...points.map((p) => p.v), threshold?.value ?? 0) * 1.15);
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * w;
  const y = (v: number) => PAD.t + h - (Math.min(v, top) / top) * h;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = `${line}L${x(t1).toFixed(1)},${y(0)}L${x(t0).toFixed(1)},${y(0)}Z`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const xTickIdx = [0, Math.round((points.length - 1) / 3), Math.round(((points.length - 1) * 2) / 3), points.length - 1];

  // Minute data over an hour reads best as HH:MM; short mock windows need seconds.
  const axisTime = t1 - t0 >= 10 * 60_000 ? fmtHourMinute : fmtTime;

  const lastPoint = points[points.length - 1];
  const hovered = hover !== null ? points[hover] : null;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setHover(Math.round(Math.min(1, Math.max(0, ratio)) * (points.length - 1)));
  };

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {ready && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label}, latest ${lastPoint ? format(lastPoint.v) : 'n/a'}`}
          className="block overflow-visible"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>

          {yTicks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={PAD.l + w} y1={y(v)} y2={y(v)} stroke="var(--color-grid)" strokeWidth={1} />
              <text x={PAD.l - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-muted text-[10px] tabular-nums">
                {shortNum(v)}
              </text>
            </g>
          ))}
          {xTickIdx.map((idx, i) => (
            <text
              key={i}
              x={x(points[idx].t)}
              y={height - 6}
              textAnchor={i === 0 ? 'start' : i === xTickIdx.length - 1 ? 'end' : 'middle'}
              className="fill-muted text-[10px] tabular-nums"
            >
              {axisTime(points[idx].t)}
            </text>
          ))}

          {threshold && threshold.value <= top && (
            <g>
              <line
                x1={PAD.l}
                x2={PAD.l + w}
                y1={y(threshold.value)}
                y2={y(threshold.value)}
                stroke="var(--color-warn)"
                strokeWidth={1}
                strokeOpacity={0.7}
              />
              <text x={PAD.l + 4} y={y(threshold.value) - 5} className="fill-warn text-[10px]">
                {threshold.label}
              </text>
            </g>
          )}

          <path d={area} fill={`url(#${gradientId})`} />
          <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {lastPoint && !hovered && (
            <circle cx={x(lastPoint.t)} cy={y(lastPoint.v)} r={4} fill={color} stroke="var(--color-panel)" strokeWidth={2} />
          )}

          {hovered && (
            <g pointerEvents="none">
              <line x1={x(hovered.t)} x2={x(hovered.t)} y1={PAD.t} y2={PAD.t + h} stroke="var(--color-ink-2)" strokeOpacity={0.4} strokeWidth={1} />
              <circle cx={x(hovered.t)} cy={y(hovered.v)} r={5} fill={color} stroke="var(--color-panel)" strokeWidth={2} />
            </g>
          )}

          <rect
            x={PAD.l}
            y={0}
            width={w}
            height={PAD.t + h}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}

      {ready && hovered && (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 border border-line bg-bg/95 px-2 py-1 text-[11px] whitespace-nowrap shadow-lg"
          style={{ left: Math.min(Math.max(x(hovered.t), PAD.l + 70), width - 70) }}
        >
          <div className="text-muted tabular-nums">{fmtDateTime(hovered.t)}</div>
          <div className="font-semibold text-ink tabular-nums">{format(hovered.v)}</div>
        </div>
      )}

      {!ready && width > 0 && (
        <div className="grid h-full place-items-center text-xs text-muted">awaiting datapoints_</div>
      )}
    </div>
  );
}
