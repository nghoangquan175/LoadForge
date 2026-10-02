'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { fmtDateTime, fmtHourMinute, fmtTime } from '@/lib/format';
import { useSteadyScroll, useTween, type ViewMove } from '@/lib/motion';
import type { MetricPoint } from '@/lib/types';

/** Where a chart looks: `end` is the right edge (epoch ms), null = follow the newest point. */
export interface ChartView extends ViewMove {
  end: number | null;
}

export const LIVE_VIEW: ChartView = { end: null, snap: false };

interface LineChartProps {
  points: MetricPoint[];
  /** CSS color, e.g. var(--color-accent) */
  color: string;
  label: string;
  format: (v: number) => string;
  /** fixed top of the y axis, otherwise a rounded max of the data */
  yMax?: number;
  /** Horizontal alarm lines, value shown on the y axis; `color` is a CSS color, warn yellow by default. `label` names it for screen readers. */
  thresholds?: { value: number; label: string; color?: string }[];
  height?: number;
  /** How long the full history is. A shorter series (a server that just started) uses it too, so every chart has the same scale. */
  historyMs?: number;
  /** Where CloudWatch ends and live seconds begin (epoch ms): drawn LIVE_STRETCH times wider per second from there. */
  liveFrom?: number;
  /** Pass both to pan several charts together. */
  view?: ChartView;
  onViewChange?: (view: ChartView) => void;
}

const PAD = { l: 40, r: 10, t: 10, b: 22 };

/** Share of the history in view; hold and drag sideways, or Shift + wheel, to see the rest. */
const VISIBLE_SHARE = 0.25;
/** Fewer points than this always fit in view, nothing to drag. */
const MIN_VISIBLE_POINTS = 8;

/**
 * Live seconds (1 s points) get this much more room per second than the
 * CloudWatch part (15 s points), so a 1 s point is as far from the next as a
 * 15 s one: the last seconds read in detail, the hour before is squeezed. Positions run on a "drawn time" that is real time up to
 * `liveFrom` and LIVE_STRETCH times faster after it.
 */
const LIVE_STRETCH = 15;

const SEC = 1000;
const MIN = 60 * SEC;
/** Time axis label spacing, the first one that fits about 4 labels. */
const TICK_STEPS = [SEC, 2 * SEC, 5 * SEC, 10 * SEC, 15 * SEC, 30 * SEC, MIN, 2 * MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, 60 * MIN];

/** Rough sizes of a 10px HH:MM:SS label and of the "now" label, for the fade. */
const TICK_HALF_WIDTH = 22;
const NOW_WIDTH = 50;
/** Closest two time labels may sit, in px. */
const MIN_TICK_GAP = 52;

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

export function LineChart({
  points,
  color,
  label,
  format,
  yMax,
  thresholds = [],
  height = 150,
  historyMs,
  liveFrom,
  view: sharedView,
  onViewChange,
}: LineChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<SVGGElement>(null);
  const axisRef = useRef<SVGGElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const nowRef = useRef<SVGTextElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const gradientId = useId();
  const clipId = useId();
  const axisClipId = useId();
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [ownView, setOwnView] = useState(LIVE_VIEW);
  const [drag, setDrag] = useState<{ x: number; end: number } | null>(null);
  const view = sharedView ?? ownView;
  const setView = onViewChange ?? setOwnView;

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

  // A changed value, scale or live start morphs; this re-renders, but only for a moment.
  const target: Record<string, number> = liveFrom === undefined ? {} : { b: liveFrom };
  for (const p of points) target[`v${p.t}`] = p.v;
  const get = useTween(target);
  /** Where stretching starts; nothing is stretched without live seconds. */
  const b = liveFrom === undefined ? Infinity : get('b');
  /** Drawn time: real time up to `b`, stretched after it. */
  const dt = (t: number) => (t <= b ? t : b + (t - b) * LIVE_STRETCH);
  const realTime = (u: number) => (u <= b ? u : b + (u - b) / LIVE_STRETCH);

  const span = dt(t1) - dt(t0) || 1;
  const step = (t1 - t0) / Math.max(points.length - 1, 1);
  // The window is in drawn time: a quarter of the hour, more of it live seconds when there are many.
  const windowMs = historyMs
    ? historyMs * VISIBLE_SHARE
    : Math.min(span, Math.max(span * VISIBLE_SHARE, step * (MIN_VISIBLE_POINTS - 1)));
  const canPan = windowMs < span;
  /** Oldest right edge: the window still starts at the first point. */
  const minEnd = realTime(dt(t0) + windowMs);
  // A past view stays on its time while new points arrive; null follows the newest.
  const end = canPan && view.end !== null ? Math.min(Math.max(view.end, minEnd), t1) : t1;
  const live = end >= t1;

  // Y scale over the whole history, so it does not jump while dragging.
  const top = yMax ?? niceMax(Math.max(...points.map((p) => p.v), ...thresholds.map((th) => th.value)) * 1.15);
  const scale = useTween({ win: windowMs, top });
  const shownWin = scale('win');
  const shownTop = scale('top');
  const val = (p: MetricPoint) => get(`v${p.t}`);

  // Drawn once per change, as if the view ended at `end`; scrolling only shifts it (apply below).
  const gx = (t: number) => PAD.l + w - ((dt(end) - dt(t)) / shownWin) * w;
  const y = (v: number) => PAD.t + h - (Math.min(v, shownTop) / shownTop) * h;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${gx(p.t).toFixed(1)},${y(val(p)).toFixed(1)}`).join('');
  const area = `${line}L${gx(t1).toFixed(1)},${y(0)}L${gx(t0).toFixed(1)},${y(0)}Z`;
  // Gridlines stay put, their labels count to the new scale.
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * shownTop);

  // Labels on round times, about 4 per window in each part: closer in time where seconds are stretched.
  const stepFor = (ms: number) => TICK_STEPS.find((st) => st >= ms / 4) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const historyStep = stepFor(windowMs);
  const liveStep = stepFor(windowMs / LIVE_STRETCH);
  const xTicks: { t: number; text: string }[] = [];
  const addTicks = (from: number, to: number, st: number) => {
    const fmt = st >= 60_000 ? fmtHourMinute : fmtTime;
    for (let t = Math.ceil(from / st) * st; t <= to; t += st) {
      // Not crowding the label before it, where the two parts meet.
      const prev = xTicks[xTicks.length - 1];
      if (prev && gx(t) - gx(prev.t) < MIN_TICK_GAP) continue;
      xTicks.push({ t, text: fmt(t) });
    }
  };
  addTicks(t0, Math.min(b, t1), historyStep);
  if (b < t1) addTicks(b + 1, t1, liveStep);

  const lastPoint = points[points.length - 1];
  const hovered = hover !== null && !drag ? points[hover] : null;

  /** The drawn line's value at time t, between its two neighbouring points. */
  const valueAt = (t: number) => {
    let i = points.length - 1;
    while (i > 0 && points[i - 1].t >= t) i--;
    const a = points[i - 1];
    const c = points[i];
    if (!a || !c || c.t <= t) return c ? val(c) : 0;
    return val(a) + ((val(c) - val(a)) * (t - a.t)) / (c.t - a.t);
  };

  // Everything the per-frame mover needs, refreshed after each render.
  const latest = useRef({ end, win: shownWin, w, t1, dt, valueAt, y, hoveredT: null as number | null });

  /** Puts the drawing where the view edge is right now: a transform, no re-render. */
  const apply = (edge: number) => {
    const s = latest.current;
    /** Screen x of time t with the view ending at `edge`. */
    const sx = (t: number) => PAD.l + s.w - ((s.dt(edge) - s.dt(t)) / s.win) * s.w;
    const dx = ((s.dt(s.end) - s.dt(edge)) / s.win) * s.w;
    scrollRef.current?.setAttribute('transform', `translate(${dx.toFixed(2)},0)`);
    axisRef.current?.setAttribute('transform', `translate(${dx.toFixed(2)},0)`);
    // The newest point is still sliding in past the right edge: the dot rides the line there.
    const dotT = Math.min(edge, s.t1);
    const dot = dotRef.current;
    if (dot) {
      dot.setAttribute('cx', sx(dotT).toFixed(2));
      dot.setAttribute('cy', s.y(s.valueAt(dotT)).toFixed(2));
    }
    const now = nowRef.current;
    const nowRight = sx(dotT) + 4;
    if (now) {
      // The time of the dot, under it on the time axis.
      now.setAttribute('x', nowRight.toFixed(2));
      const text = fmtTime(dotT);
      if (now.textContent !== text) now.textContent = text;
    }
    // Time labels fade out as they reach the "now" label or the left edge, instead of being cut.
    for (const label of axisRef.current?.children ?? []) {
      const x = Number(label.getAttribute('x')) + dx;
      const toNow = now ? (nowRight - NOW_WIDTH - (x + TICK_HALF_WIDTH)) / 16 : 1;
      const toLeft = (x - TICK_HALF_WIDTH - (PAD.l - 4)) / 16;
      label.setAttribute('opacity', Math.min(Math.max(Math.min(toNow, toLeft), 0), 1).toFixed(2));
    }
    if (tipRef.current && s.hoveredT !== null) {
      tipRef.current.style.left = `${Math.min(Math.max(sx(s.hoveredT), PAD.l + 70), s.w + PAD.l + PAD.r - 70)}px`;
    }
  };

  const edge = useSteadyScroll(end, !canPan || view.end === null, view, apply);

  useLayoutEffect(() => {
    latest.current = { end, win: shownWin, w, t1, dt, valueAt, y, hoveredT: hovered?.t ?? null };
    apply(edge());
  });

  /** Nearest point to a pixel in the plot. */
  const pointAt = (px: number) => {
    const u = dt(edge()) - shownWin + (Math.min(Math.max(px, 0), w) / w) * shownWin;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(dt(points[i].t) - u) < Math.abs(dt(points[best].t) - u)) best = i;
    return best;
  };

  /** Moves the view to end at drawn time `u`; reaching the newest point goes back to live. */
  const panTo = (u: number, snap: boolean) => {
    const next = realTime(u);
    setView({ end: next >= t1 ? null : Math.max(next, minEnd), snap });
  };

  const onDown = (e: React.PointerEvent<SVGRectElement>) => {
    if (!canPan) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ x: e.clientX, end });
  };

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (drag) {
      // Drag right to go back in time, like moving paper. Follows the pointer, no glide.
      panTo(dt(drag.end) - ((e.clientX - drag.x) / w) * windowMs, true);
      return;
    }
    setHover(pointAt(e.clientX - e.currentTarget.getBoundingClientRect().left));
  };

  // Shift + wheel (or a sideways trackpad swipe) pans at once; a plain wheel still scrolls the page.
  // Native listener: React's onWheel is passive and cannot stop the page from scrolling.
  const onWheel = useRef<(e: WheelEvent) => void>(undefined);
  useEffect(() => {
    onWheel.current = (e) => {
      const delta = e.shiftKey ? e.deltaX || e.deltaY : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
      if (!canPan || !delta) return;
      e.preventDefault();
      setHover(null);
      // Down / right moves toward now.
      panTo(dt(end) + (delta / w) * windowMs, true);
    };
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = (e: WheelEvent) => onWheel.current?.(e);
    el.addEventListener('wheel', listener, { passive: false });
    return () => el.removeEventListener('wheel', listener);
  }, []);

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
            <clipPath id={clipId}>
              <rect x={PAD.l} y={0} width={w} height={PAD.t + h} />
            </clipPath>
            {/* Time labels scroll under the plot edges; a little slack so a whole label shows near the edge. */}
            <clipPath id={axisClipId}>
              <rect x={PAD.l - 4} y={PAD.t + h} width={w + 8} height={PAD.b} />
            </clipPath>
          </defs>

          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={PAD.l} x2={PAD.l + w} y1={y(v)} y2={y(v)} stroke="var(--color-grid)" strokeWidth={1} />
              <text x={PAD.l - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-muted text-[10px] tabular-nums">
                {shortNum(v)}
              </text>
            </g>
          ))}

          <g clipPath={`url(#${axisClipId})`}>
            <g ref={axisRef}>
              {xTicks.map(({ t, text }) => (
                <text key={t} x={gx(t)} y={height - 6} textAnchor="middle" className="fill-muted text-[10px] tabular-nums">
                  {text}
                </text>
              ))}
            </g>
          </g>

          {thresholds
            .filter((th) => th.value <= top)
            .map((th) => (
              <g key={th.label} aria-label={th.label}>
                <line
                  x1={PAD.l}
                  x2={PAD.l + w}
                  y1={y(th.value)}
                  y2={y(th.value)}
                  stroke={th.color ?? 'var(--color-warn)'}
                  strokeWidth={1}
                  strokeOpacity={0.7}
                />
                {/* Its value sits on the y axis with the other numbers, in the line's color. */}
                <text x={PAD.l - 8} y={y(th.value)} dy="0.32em" textAnchor="end" fill={th.color ?? 'var(--color-warn)'} className="text-[10px] tabular-nums">
                  {shortNum(th.value)}
                </text>
              </g>
            ))}

          <g clipPath={`url(#${clipId})`}>
            <g ref={scrollRef}>
              <path d={area} fill={`url(#${gradientId})`} />
              <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {hovered && (
                <g pointerEvents="none">
                  <line x1={gx(hovered.t)} x2={gx(hovered.t)} y1={PAD.t} y2={PAD.t + h} stroke="var(--color-ink-2)" strokeOpacity={0.4} strokeWidth={1} />
                  <circle cx={gx(hovered.t)} cy={y(val(hovered))} r={5} fill={color} stroke="var(--color-panel)" strokeWidth={2} />
                </g>
              )}
            </g>
          </g>

          {/* Placed on every frame by apply(). */}
          {lastPoint && live && (
            <>
              <circle ref={dotRef} r={4} fill={color} stroke="var(--color-panel)" strokeWidth={2} />
              {/* Panel-coloured outline hides a scrolling time label underneath. */}
              <text
                ref={nowRef}
                y={height - 6}
                textAnchor="end"
                fill="var(--color-muted)"
                stroke="var(--color-panel)"
                strokeWidth={6}
                paintOrder="stroke"
                className="text-[10px] font-semibold tabular-nums"
              />
            </>
          )}

          <rect
            x={PAD.l}
            y={0}
            width={w}
            height={PAD.t + h}
            fill="transparent"
            // Vertical swipes still scroll the page on touch screens.
            style={{ touchAction: canPan ? 'pan-y' : undefined }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={() => setDrag(null)}
            onPointerCancel={() => setDrag(null)}
            onPointerLeave={() => setHover(null)}
            onDoubleClick={() => setView({ end: null, snap: false })}
          />
        </svg>
      )}

      {ready && hovered && (
        <div
          ref={tipRef}
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 border border-line bg-bg/95 px-2 py-1 text-[11px] whitespace-nowrap shadow-lg"
        >
          <div className="text-muted tabular-nums">{fmtDateTime(hovered.t)}</div>
          <div className="font-semibold text-ink tabular-nums">{format(hovered.v)}</div>
        </div>
      )}

      {ready && !live && (
        <button
          onClick={() => setView({ end: null, snap: false })}
          className="absolute top-0 right-2 border border-accent/50 bg-bg/90 px-1.5 text-[10px] text-accent hover:bg-accent/10"
        >
          live ▸
        </button>
      )}

      {!ready && width > 0 && (
        <div className="grid h-full place-items-center text-xs text-muted">awaiting datapoints_</div>
      )}
    </div>
  );
}
