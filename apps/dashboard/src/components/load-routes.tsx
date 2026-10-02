'use client';

import { memo, useEffect, useState } from 'react';
import { fmtDuration, fmtInt } from '@/lib/format';
import { LOAD_ROUTE } from '@/lib/load-routes';
import { useAttacker } from '@/lib/use-attacker';
import { useNow } from '@/lib/use-live-snapshot';

type Field = 'total' | 'minutes' | 'rate';
const FIELDS: Field[] = ['total', 'minutes', 'rate'];

const LABELS: Record<Field, string> = {
  total: 'total requests',
  minutes: 'duration (min)',
  rate: 'requests / s',
};

// Mirror the Attacker box's own caps (apps/attacker: MAX_RATE, MAX_DURATION_SEC).
const MAX_RATE = 1000;
const MAX_MINUTES = 30;
const MAX_TOTAL = MAX_RATE * MAX_MINUTES * 60;

const BTN = 'inline-flex cursor-pointer items-center gap-2 border px-3 py-1.5 text-xs font-semibold transition-colors';

/** SVG glyphs: text symbols sit off-center in a monospace font. */
function Icon({ name }: { name: 'play' | 'stop' }) {
  return (
    <svg viewBox="0 0 10 10" className="size-2.5 shrink-0" aria-hidden>
      {name === 'play' && <path d="M2 1 L9 5 L2 9 Z" fill="currentColor" />}
      {name === 'stop' && <rect x="1.5" y="1.5" width="7" height="7" fill="currentColor" />}
    </svg>
  );
}

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
  if (rate > MAX_RATE) return `rate max ${MAX_RATE}/s`;
  if (minutes > MAX_MINUTES) return `duration max ${MAX_MINUTES} min`;
  if (total > MAX_TOTAL) return `total requests max ${fmtInt(MAX_TOTAL)}`;
  return null;
}

/** onActiveChange: a run is live, so the panel wants more room. */
export const LoadRoutes = memo(function LoadRoutes({ onActiveChange }: { onActiveChange?: (active: boolean) => void }) {
  const [values, setValues] = useState<Record<Field, string>>({ total: '18000', minutes: '5', rate: '60' });
  // Fields the user typed, oldest first; the third one is computed.
  const [typed, setTyped] = useState<Field[]>(['minutes', 'rate']);
  const { status, error: controlError, busy, start, update, stop } = useAttacker();
  const now = useNow();

  const running = status?.state === 'running';
  useEffect(() => onActiveChange?.(running), [running, onActiveChange]);

  const derived = FIELDS.find((f) => !typed.slice(-2).includes(f));
  const planError = validate(values);
  const plan = { rate: Math.round(num(values.rate)), durationSec: Math.round(num(values.minutes) * 60) };

  // Typed but not applied yet, while a run is live.
  const changed = running && status?.plan && (plan.rate !== status.plan.rate || plan.durationSec !== status.plan.durationSec);

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

  const apply = () => {
    if (changed && !planError) void update(plan);
  };

  const target = status?.target ?? `${LOAD_ROUTE.path}?${LOAD_ROUTE.query}`;
  const remainMs = running && status?.endsAt && now ? Math.max(0, status.endsAt - now) : 0;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-[2px] bg-crit/15 px-1.5 py-0.5 text-[10px] font-bold text-crit">ATTACKER</span>
        <code className="break-all text-ink">{target}</code>
      </div>

      {/* How the generator is reachable, before the plan. */}
      {status && !status.configured && (
        <div className="border border-warn/40 bg-warn/5 px-3 py-2 text-[11px] text-warn">
          <span aria-hidden>▲ </span>No Attacker is wired up. Deploy infra/attacker and set the Watcher&rsquo;s ATTACKER_URL.
        </div>
      )}
      {status?.configured && !status.online && (
        <div className="border border-crit/40 bg-crit/5 px-3 py-2 text-[11px] text-crit">
          <span aria-hidden>✖ </span>Attacker unreachable. Is the EC2 instance started?
        </div>
      )}

      <div className="rounded-[3px] border border-line bg-bg/80 p-3">
        <div className="mb-2 text-[10px] tracking-[0.18em] text-muted uppercase">
          load plan · fill any two{running && ' · change it while the run is live'}
        </div>
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
                onChange={(e) => edit(f, e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && apply()}
                className={`mt-1 w-full border bg-bg px-2 py-1.5 text-sm tabular-nums outline-none focus:border-accent/70 ${
                  f === derived ? 'border-cyan/40 text-cyan' : 'border-line text-ink'
                }`}
              />
            </label>
          ))}
        </div>
        {planError && <p className="mt-2 text-[11px] text-crit"><span aria-hidden>✖ </span>{planError}</p>}
        {controlError && !planError && <p className="mt-2 text-[11px] text-crit"><span aria-hidden>✖ </span>{controlError}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!running && (
            <button
              onClick={() => void start(plan)}
              disabled={!!planError || busy || !status?.online}
              className={`${BTN} border-crit/70 bg-crit/10 text-crit hover:bg-crit/20 disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <Icon name="play" />start attack
            </button>
          )}
          {changed && (
            <button
              onClick={apply}
              disabled={!!planError || busy}
              className={`${BTN} border-cyan/70 bg-cyan/10 text-cyan hover:bg-cyan/20 disabled:cursor-not-allowed disabled:opacity-50`}
            >
              apply changes
            </button>
          )}
          {running && (
            <button onClick={() => void stop()} disabled={busy} className={`${BTN} border-warn/70 bg-warn/10 text-warn hover:bg-warn/20`}>
              <Icon name="stop" />stop
            </button>
          )}
          <span className="text-[10px] text-muted">sent from the Attacker box, not this browser</span>
        </div>
      </div>

      {status?.online && (
        <div className="space-y-2 text-xs" aria-live="polite">
          <div className="flex items-center justify-between text-[10px] tracking-wider text-muted uppercase">
            <span>
              <span className={running ? 'text-crit' : 'text-muted'}>{running ? 'attacking' : 'idle'}</span>
              {running && status.plan && <> · {status.plan.rate} req/s</>}
            </span>
            {running && <span className="tabular-nums">{fmtDuration(remainMs)} left</span>}
            {!running && status.lastResult && <span className="text-muted">last run: {status.lastResult}</span>}
          </div>
          <p className="text-[10px] text-muted">
            Watch the CPU, request and scaling panels above for how the Defenders react.
          </p>
        </div>
      )}
    </div>
  );
});
