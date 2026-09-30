'use client';

import { fmtCompact, fmtDateTime, fmtInt, fmtTime, last, TZ_LABEL } from '@/lib/format';
import { API_URL, apiOrigin, useLiveSnapshot, useNow } from '@/lib/use-live-snapshot';
import { ActivityLog } from './activity-log';
import { Capacity } from './capacity';
import { InstanceTable } from './instance-table';
import { LineChart } from './line-chart';
import { LoadRoutes } from './load-routes';
import { Panel } from './panel';
import { StatTile, type Severity } from './stat-tile';
import { TopBar } from './top-bar';

const BOOT_LINES = [
  'initializing loadforge control plane…',
  `opening event stream ${API_URL}/api/stream`,
  'resolving auto scaling group…',
];

function BootScreen() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-lg space-y-1.5 text-sm">
        <div className="glow mb-4 text-2xl font-bold tracking-[0.3em] text-accent">LOADFORGE</div>
        {BOOT_LINES.map((line, i) => (
          <div key={line} className="animate-slide-in text-ink-2" style={{ animationDelay: `${i * 150}ms`, animationFillMode: 'backwards' }}>
            <span className="text-accent">[ ok ]</span> {line}
          </div>
        ))}
        <div className="text-accent"><span className="animate-blink">▌</span></div>
      </div>
    </main>
  );
}

export function Dashboard({ canLogout }: { canLogout: boolean }) {
  const { snapshot, link } = useLiveSnapshot();
  const now = useNow();

  if (!snapshot || now === null) return <BootScreen />;

  const { asg, metrics, targetCpu } = snapshot;
  const cpu = last(metrics.cpu)?.v ?? 0;
  const reqs = last(metrics.requests)?.v ?? 0;
  const latency = last(metrics.latencyMs)?.v ?? 0;
  const errors = last(metrics.errors5xx)?.v ?? 0;

  const cpuSeverity: Severity = cpu >= 90 ? 'crit' : cpu > targetCpu ? 'warn' : 'ok';
  const latencySeverity: Severity = latency >= 800 ? 'crit' : latency >= 300 ? 'warn' : 'ok';
  const errorSeverity: Severity = errors >= 50 ? 'crit' : errors > 5 ? 'warn' : 'ok';

  return (
    <main className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-5 sm:px-6">
      <TopBar
        link={link}
        source={snapshot.source}
        asgName={asg.name}
        region={snapshot.region}
        clock={fmtDateTime(now)}
        canLogout={canLogout}
      />

      {link === 'fallback' && (
        <div className="border border-warn/40 bg-warn/5 px-4 py-2 text-xs text-warn">
          <span aria-hidden>▲ </span>
          server unreachable at {apiOrigin()} — showing a local simulation.
          {API_URL.includes('localhost') && (
            <> Start it with <code className="text-ink">npm run dev:server</code>.</>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel title="Capacity" tag={`asg:${asg.name}`} className="lg:col-span-4">
          <Capacity asg={asg} />
        </Panel>

        <div className="grid grid-cols-2 gap-4 lg:col-span-8">
          <StatTile
            label="Avg CPU"
            value={cpu.toFixed(1)}
            unit="%"
            color="var(--color-accent)"
            severity={cpuSeverity}
            trend={metrics.cpu}
            note={cpuSeverity === 'ok' ? `under target ${targetCpu}%` : `over target ${targetCpu}% · scaling out`}
          />
          <StatTile
            label="Requests"
            value={fmtCompact(reqs)}
            unit="/min"
            color="var(--color-cyan)"
            severity="ok"
            trend={metrics.requests}
            note={`${fmtInt(reqs / Math.max(asg.inService, 1))} per instance`}
          />
          <StatTile
            label="Latency"
            value={fmtInt(latency)}
            unit="ms"
            color="var(--color-violet)"
            severity={latencySeverity}
            trend={metrics.latencyMs}
            note={latencySeverity === 'ok' ? 'target response time ok' : 'responses getting slow'}
          />
          <StatTile
            label="5xx errors"
            value={fmtInt(errors)}
            unit="/min"
            color="var(--color-crit)"
            severity={errorSeverity}
            trend={metrics.errors5xx}
            note={errorSeverity === 'ok' ? 'no error spike' : 'instances overloaded'}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:col-span-8">
          <Panel title="CPU utilization" tag="AWS/EC2 · CPUUtilization · avg">
            <LineChart
              points={metrics.cpu}
              color="var(--color-accent)"
              label="Average CPU utilization"
              format={(v) => `${v.toFixed(1)}%`}
              yMax={100}
              threshold={{ value: targetCpu, label: `target ${targetCpu}%` }}
            />
          </Panel>
          <Panel title="Request rate" tag="AWS/ApplicationELB · RequestCount">
            <LineChart
              points={metrics.requests}
              color="var(--color-cyan)"
              label="Requests per minute"
              format={(v) => `${fmtInt(v)} req/min`}
            />
          </Panel>
          <Panel title="Response time" tag="AWS/ApplicationELB · TargetResponseTime">
            <LineChart
              points={metrics.latencyMs}
              color="var(--color-violet)"
              label="Target response time"
              format={(v) => `${fmtInt(v)} ms`}
            />
          </Panel>
          <Panel title="5xx errors" tag="AWS/ApplicationELB · HTTPCode_Target_5XX">
            <LineChart
              points={metrics.errors5xx}
              color="var(--color-crit)"
              label="Target 5xx errors per minute"
              format={(v) => `${fmtInt(v)} /min`}
            />
          </Panel>
        </div>

        <Panel title="Scaling activity" tag="autoscaling:DescribeScalingActivities" className="h-[520px] xl:col-span-4 xl:h-auto" bodyClassName="relative">
          {/* absolute so a long log scrolls instead of stretching the row */}
          <div className="absolute inset-3">
            <ActivityLog activities={snapshot.activities} />
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Panel title="Instances" tag="autoscaling:DescribeAutoScalingGroups" className="xl:col-span-7">
          <InstanceTable instances={snapshot.instances} now={now} />
        </Panel>
        <Panel title="Load test" tag="GET /api/load/*" className="xl:col-span-5">
          <LoadRoutes />
        </Panel>
      </div>

      <footer className="flex flex-wrap justify-between gap-2 border-t border-line pt-3 text-[10px] tracking-wider text-muted uppercase">
        <span>loadforge v0.1 · source {snapshot.source} · period {metrics.periodSec}s</span>
        <span className="tabular-nums">last update {fmtTime(snapshot.ts)} {TZ_LABEL}</span>
      </footer>
    </main>
  );
}
