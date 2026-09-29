import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authMode, safeNext } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'LoadForge // Login',
};

const ERRORS: Record<string, string> = {
  denied: 'access denied: invalid credentials',
  config: 'auth not configured: set DASHBOARD_PASSWORD on the server',
};

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const error = typeof params.error === 'string' ? ERRORS[params.error] : undefined;

  if (authMode().mode === 'disabled') redirect(next);

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-10 place-items-center border border-accent/60 bg-accent/10 text-base font-bold text-accent">&gt;_</span>
          <div>
            <div className="glow text-xl font-bold tracking-[0.3em] text-accent">LOADFORGE</div>
            <div className="text-[10px] tracking-[0.2em] text-muted uppercase">asg control plane</div>
          </div>
        </div>

        <section className="brackets border border-line bg-panel/90">
          <header className="border-b border-line px-4 py-2.5 text-[11px] font-semibold tracking-[0.18em] text-ink-2 uppercase">
            <span className="text-accent">{'// '}</span>authenticate
          </header>

          <div className="space-y-1 border-b border-line bg-bg/60 px-4 py-3 text-xs">
            <div className="text-muted">
              <span className="text-accent">guest@internet</span>:<span className="text-cyan">~</span>$ ssh operator@loadforge
            </div>
            <div className="text-ink-2">
              <span className="text-warn" aria-hidden>▲ </span>restricted system. authorized operators only.
            </div>
          </div>

          <form action="/auth/login" method="post" className="space-y-4 p-4">
            <input type="hidden" name="next" value={next} />

            <label className="block">
              <span className="text-[10px] tracking-[0.18em] text-muted uppercase">user</span>
              <span className="mt-1.5 flex items-center gap-2 border border-line bg-bg/80 px-3 py-2 focus-within:border-accent/70">
                <span className="text-accent" aria-hidden>&gt;</span>
                <input
                  name="user"
                  autoComplete="username"
                  required
                  autoFocus
                  spellCheck={false}
                  className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
                  placeholder="admin"
                />
              </span>
            </label>

            <label className="block">
              <span className="text-[10px] tracking-[0.18em] text-muted uppercase">password</span>
              <span className="mt-1.5 flex items-center gap-2 border border-line bg-bg/80 px-3 py-2 focus-within:border-accent/70">
                <span className="text-accent" aria-hidden>&gt;</span>
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
                  placeholder="••••••••"
                />
              </span>
            </label>

            {error && (
              <p role="alert" className="border border-crit/40 bg-crit/5 px-3 py-2 text-xs text-crit">
                <span aria-hidden>✖ </span>
                {error}
              </p>
            )}

            <button
              type="submit"
              className="w-full border border-accent/70 bg-accent/10 py-2.5 text-sm font-semibold tracking-wider text-accent transition-colors hover:bg-accent/20"
            >
              ▶ authenticate
            </button>
          </form>
        </section>

        <p className="mt-4 text-center text-[10px] tracking-wider text-muted uppercase">
          session expires after 12h<span className="animate-blink text-accent"> ▌</span>
        </p>
      </div>
    </main>
  );
}
