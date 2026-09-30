'use client';

import { useState } from 'react';
import { fmtDuration, fmtInt } from '@/lib/format';
import { LOAD_ROUTES } from '@/lib/load-routes';
import { MAX_RATE, MAX_TOTAL, type RunStatus, useLoadRunner } from '@/lib/use-load-runner';
import { API_URL, apiOrigin } from '@/lib/use-live-snapshot';

type Field = 'total' | 'minutes' | 'rate';
const FIELDS: Field[] = ['total', 'minutes', 'rate'];

const LABELS: Record<Field, string> = {
  total: 'total requests',
  minutes: 'duration (min)',
  rate: 'requests / s',
};

const MAX_MINUTES = 60;

const BTN = 'cursor-pointer border px-3 py-1.5 text-xs font-semibold transition-colors';

const STATUS_STYLE: Record<RunStatus, string> = {
  idle: 'text-muted',
  running: 'text-accent',
  paused: 'text-warn',
  finished: 'text-cyan',
};

const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
const tidy = (n: number, digits: number) => String(Number(n.toFixed(digits)));

/** Fills the one field the user did not type, from the two they did. */
function derive(target: Field, v: Record<Field, string>): string {
  const total = num(v.total);
  const seconds = num(v.minutes) * 60;
  const rate = num(v.rate);
  switch (target) {
    case 'total':
      return tidy(Math.round(rate * seconds), 0);
    case 'minutes':
      return tidy(total / rate / 60, 2);
    case 'rate':
      return tidy(total / seconds, 2);
  }
}

function validate(v: Record<Field, string>): string | null {
  const total = num(v.total);
  const minutes = num(v.minutes);
  const rate = num(v.rate);
  if ([total, minutes, rate].some((n) => !Number.isFinite(n) || n <= 0)) return 'fill any two fields with numbers above 0';
  if (total > MAX_TOTAL) return `total requests max ${fmtInt(MAX_TOTAL)}`;
  if (minutes > MAX_MINUTES) return `duration max ${MAX_MINUTES} min`;
  if (rate > MAX_RATE) return `max ${MAX_RATE} requests/s from one browser`;
  return null;
}

export function LoadRoutes() {
  const [active, setActive] = useState(LOAD_ROUTES[0].key);
  const [values, setValues] = useState<Record<Field, string>>({ total: '4800', minutes: '5', rate: '16' });
  // Fields the user typed, oldest first; the third one is computed.
  const [typed, setTyped] = useState<Field[]>(['minutes', 'rate']);
  const { stats, start, stop, resume, remove } = useLoadRunner();
  // Plan and route are fixed once a test exists; delete it to change them.
  const locked = stats.status !== 'idle';

  const route = LOAD_ROUTES.find((r) => r.key === active)!;
  const url = `${API_URL}${route.path}?${route.query}`;
  const derived = FIELDS.find((f) => !typed.slice(-2).includes(f));
  const error = validate(values);

  const edit = (field: Field, raw: string) => {
    const next = { ...values, [field]: raw };
    const order = [...typed.filter((f) => f !== field), ...(raw.trim() ? [field] : [])];
    const inputs = order.filter((f) => Number.isFinite(num(next[f])) && num(next[f]) > 0).slice(-2);
    if (inputs.length === 2) {
      const target = FIELDS.find((f) => !inputs.includes(f))!;
      next[target] = derive(target, next);
    }
    setValues(next);
    setTyped(order);
  };

  const elapsed = stats.elapsedMs;
  const achieved = elapsed > 0 ? stats.sent / (elapsed / 1000) : 0;
  const progress = stats.total ? Math.min(100, (stats.sent / stats.total) * 100) : 0;
  const done = stats.ok + stats.failed;

  return (
    <div className="flex h-full flex-col gap-4">
      <div role="tablist" className="grid grid-cols-3 gap-1.5">
        {LOAD_ROUTES.map((r) => (
          <button
            key={r.key}
            role="tab"
            aria-selected={r.key === active}
            disabled={locked}
            onClick={() => setActive(r.key)}
            className={`border px-2 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              r.key === active
                ? 'border-accent/70 bg-accent/10 text-ink'
                : 'border-line text-ink-2 hover:border-accent/40 hover:text-ink'
            }`}
          >
            <div className="text-[10px] tracking-widest text-muted">{r.bound}</div>
            <div className="truncate text-xs font-semibold">{r.name}</div>
          </button>
        ))}
      </div>

      <div className="space-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[2px] bg-cyan/15 px-1.5 py-0.5 text-[10px] font-bold text-cyan">GET</span>
          <code className="break-all text-ink">{route.path}<span className="text-muted">?{route.query}</span></code>
        </div>
        <p className="text-ink-2">
          <span className="text-muted">how it works · </span>
          {route.work}
        </p>
        <p className="text-warn">
          <span aria-hidden>▲ </span>
          {route.expect}
        </p>
      </div>

      <div className="rounded-[3px] border border-line bg-bg/80 p-3">
        <div className="mb-2 text-[10px] tracking-[0.18em] text-muted uppercase">load plan · fill any two</div>
        <div className="grid grid-cols-3 gap-2">
          {FIELDS.map((f) => (
            <label key={f} className="block min-w-0">
              <span className="flex items-center gap-1.5 text-[10px] tracking-wider text-muted uppercase">
                {LABELS[f]}
                {f === derived && <span className="rounded-[2px] bg-cyan/15 px-1 text-[9px] text-cyan normal-case">auto</span>}
              </span>
              <input
                inputMode="decimal"
                value={values[f]}
                disabled={locked}
                onChange={(e) => edit(f, e.target.value)}
                className={`mt-1 w-full border bg-bg px-2 py-1.5 text-sm tabular-nums outline-none focus:border-accent/70 disabled:opacity-60 ${
                  f === derived ? 'border-cyan/40 text-cyan' : 'border-line text-ink'
                }`}
              />
            </label>
          ))}
        </div>
        {error && !locked && (
          <p className="mt-2 text-[11px] text-crit">
            <span aria-hidden>✖ </span>
            {error}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {stats.status === 'idle' && (
            <button
              onClick={() => start(url, Number(values.total), Number(values.rate))}
              disabled={!!error}
              className={`${BTN} border-accent/70 bg-accent/10 text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50`}
            >
              ▶ start load
            </button>
          )}
          {stats.status === 'running' && (
            <button onClick={stop} className={`${BTN} border-warn/70 bg-warn/10 text-warn hover:bg-warn/20`}>
              ‖ stop
            </button>
          )}
          {stats.status === 'paused' && (
            <button onClick={resume} className={`${BTN} border-accent/70 bg-accent/10 text-accent hover:bg-accent/20`}>
              ▶ continue
            </button>
          )}
          {locked && (
            <button onClick={remove} className={`${BTN} border-crit/60 text-crit hover:bg-crit/10`}>
              ✕ delete test
            </button>
          )}
          <span className="text-[10px] text-muted">sent from this browser to {apiOrigin()}</span>
        </div>
      </div>

      {locked && (
        <div className="space-y-2 text-xs" aria-live="polite">
          <div className="flex items-center justify-between text-[10px] tracking-wider text-muted uppercase">
            <span>
              <span className={STATUS_STYLE[stats.status]}>{stats.status}</span> · {fmtDuration(elapsed)}
            </span>
            <span className="tabular-nums">{fmtInt(stats.sent)} / {fmtInt(stats.total)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-accent/15">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${progress}%` }} />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            {[
              ['ok', fmtInt(stats.ok), 'text-accent'],
              ['failed', fmtInt(stats.failed), stats.failed ? 'text-crit' : 'text-ink'],
              ['avg latency', done ? `${fmtInt(stats.avgMs)} ms` : '—', 'text-ink'],
              [
                'rate',
                `${achieved.toFixed(1)} / ${stats.rate} /s`,
                stats.status === 'running' && achieved < stats.rate * 0.9 && elapsed > 3000 ? 'text-warn' : 'text-ink',
              ],
            ].map(([k, v, cls]) => (
              <div key={k}>
                <dt className="text-[10px] tracking-wider text-muted uppercase">{k}</dt>
                <dd className={`tabular-nums ${cls}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

    </div>
  );
}
