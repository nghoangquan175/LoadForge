import { TZ_LABEL } from '@/lib/format';
import type { LinkState } from '@/lib/use-live-snapshot';
import type { DataSource } from '@/lib/types';

const LINK_STYLE = {
  live_aws: { label: 'LIVE · AWS', className: 'text-accent border-accent/50 bg-accent/10' },
  live_mock: { label: 'LIVE · MOCK DATA', className: 'text-cyan border-cyan/50 bg-cyan/10' },
  fallback: { label: 'OFFLINE · SIMULATED', className: 'text-warn border-warn/50 bg-warn/10' },
  connecting: { label: 'CONNECTING', className: 'text-muted border-line' },
} as const;

interface TopBarProps {
  link: LinkState;
  source: DataSource | null;
  asgName: string;
  region: string;
  clock: string;
  canLogout: boolean;
}

export function TopBar({ link, source, asgName, region, clock, canLogout }: TopBarProps) {
  const key = link === 'live' ? (source === 'aws' ? 'live_aws' : 'live_mock') : link;
  const style = LINK_STYLE[key];

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line pb-4">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center border border-accent/60 bg-accent/10 text-sm font-bold text-accent">&gt;_</span>
          <span className="glow text-lg font-bold tracking-[0.3em] text-accent">LOADFORGE</span>
        </div>
        <div className="hidden min-w-0 truncate text-xs text-muted lg:block">
          <span className="text-accent">root@loadforge</span>:<span className="text-cyan">~</span>$ watch asg/{asgName} --region {region}
          <span className="animate-blink text-accent"> ▌</span>
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs">
        <span
          className={`flex items-center gap-2 border px-2.5 py-1 font-semibold tracking-wider ${style.className}`}
          title={link === 'fallback' ? 'Server unreachable. Showing local simulation.' : undefined}
        >
          <span className="size-1.5 animate-pulse-dot rounded-full bg-current" />
          {style.label}
        </span>
        <span className="hidden text-ink-2 sm:inline">{region}</span>
        <span className="text-ink tabular-nums">{clock} <span className="text-muted">{TZ_LABEL}</span></span>
        {canLogout && (
          <form action="/auth/logout" method="post">
            <button type="submit" className="border border-line px-2.5 py-1 text-ink-2 transition-colors hover:border-crit/60 hover:text-crit">
              <span aria-hidden>⏻ </span>logout
            </button>
          </form>
        )}
      </div>
    </header>
  );
}
