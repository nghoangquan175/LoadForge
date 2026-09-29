'use client';

import { useState } from 'react';
import { k6Script, LOAD_ROUTES } from '@/lib/load-routes';
import { API_URL, apiOrigin } from '@/lib/use-live-snapshot';

type FireResult =
  | { ok: true; ms: number; status: number; body: string }
  | { ok: false; error: string };

export function LoadRoutes() {
  const [active, setActive] = useState(LOAD_ROUTES[0].key);
  const [copied, setCopied] = useState(false);
  const [firing, setFiring] = useState(false);
  const [result, setResult] = useState<FireResult | null>(null);

  const route = LOAD_ROUTES.find((r) => r.key === active)!;
  const script = k6Script(route);
  const command = `k6 run -e BASE_URL=${apiOrigin()} ${route.key}.js`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const fire = async () => {
    setFiring(true);
    setResult(null);
    const started = performance.now();
    try {
      const res = await fetch(`${API_URL}${route.path}?${route.query}`);
      const body = await res.text();
      setResult({ ok: true, ms: Math.round(performance.now() - started), status: res.status, body });
    } catch {
      setResult({ ok: false, error: `connection refused: ${apiOrigin()} is offline` });
    } finally {
      setFiring(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div role="tablist" className="grid grid-cols-3 gap-1.5">
        {LOAD_ROUTES.map((r) => (
          <button
            key={r.key}
            role="tab"
            aria-selected={r.key === active}
            onClick={() => {
              setActive(r.key);
              setResult(null);
            }}
            className={`border px-2 py-2 text-left transition-colors ${
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

      <div className="text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[2px] bg-cyan/15 px-1.5 py-0.5 text-[10px] font-bold text-cyan">GET</span>
          <code className="break-all text-ink">{route.path}<span className="text-muted">?{route.query}</span></code>
        </div>
        <p className="mt-2 text-ink-2">{route.description}</p>
        <p className="mt-1 text-warn"><span aria-hidden>▲ </span>{route.lesson}</p>
        <ul className="mt-2 space-y-0.5 text-[11px] text-muted">
          {route.params.map((p) => (
            <li key={p.name}><span className="text-ink-2">{p.name}</span> — {p.hint}</li>
          ))}
        </ul>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[3px] border border-line bg-bg/80">
        <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[10px] text-muted">
          <span>{route.key}.js</span>
          <button onClick={copy} className="text-ink-2 transition-colors hover:text-accent">
            {copied ? '✔ copied' : 'copy'}
          </button>
        </div>
        <pre className="max-h-56 overflow-auto px-3 py-2 text-[11px] leading-relaxed text-ink-2">{script}</pre>
        <div className="border-t border-line px-3 py-1.5 text-[11px] text-muted">
          <span className="text-accent">$</span> {command}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={fire}
          disabled={firing}
          className="border border-accent/70 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
        >
          {firing ? 'firing…' : '▶ fire once'}
        </button>
        <div className="min-w-0 flex-1 truncate text-[11px]" aria-live="polite">
          {result?.ok && (
            <span className={result.status < 400 ? 'text-ink-2' : 'text-crit'}>
              <span className="text-accent">HTTP {result.status}</span> · {result.ms}ms · <span className="text-muted">{result.body}</span>
            </span>
          )}
          {result && !result.ok && <span className="text-crit">✖ {result.error}</span>}
        </div>
      </div>
    </div>
  );
}
