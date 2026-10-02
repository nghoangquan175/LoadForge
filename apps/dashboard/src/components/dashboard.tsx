'use client';

import { useState } from 'react';
import { fmtCompact, fmtDateTime, fmtInt, fmtTime, last, TZ_LABEL } from '@/lib/format';
import { groupPoints, joinSources } from '@/lib/live-merge';
import { useLiveSnapshot, useNow, WATCHER_URL, watcherOrigin } from '@/lib/use-live-snapshot';
import { ActivityLog } from './activity-log';
import { Capacity } from './capacity';
import { InstanceTable } from './instance-table';
import { LineChart, LIVE_VIEW } from './line-chart';
import { LoadRoutes } from './load-routes';
import { Panel } from './panel';
import { ServerPicker } from './server-picker';
import { StatTile, type Severity } from './stat-tile';
import { TopBar } from './top-bar';

/** Danger alarm level: above it for 30 s adds 2 servers (infra/compute.tf, danger_cpu). */
const DANGER_CPU = 90;

const BOOT_LINES = [
  'initializing loadforge control plane…',
  `opening event stream ${WATCHER_URL}/monitor/stream`,
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
  const { snapshot, link, live } = useLiveSnapshot();
  const now = useNow();
  // null = average of all servers; otherwise one instance id.
  const [selected, setSelected] = useState<string | null>(null);
  // While a load test exists its per-server report needs room: Instances and Load test go 50/50.
  const [testActive, setTestActive] = useState(false);
  // The four charts pan together, so they always show the same minutes.
  const [chartView, setChartView] = useState(LIVE_VIEW);

  if (!snapshot || now === null) return <BootScreen />;

  const { asg, metrics, targetCpu } = snapshot;
  // CPU per server from /live when there is any: CloudWatch's is minutes old.
  const lastCpu = (id: string) => live.seconds[id]?.[live.seconds[id].length - 1]?.cpu;
  const instances = snapshot.instances.map((i) => ({ ...i, cpu: lastCpu(i.id) ?? i.cpu }));
  const serving = instances.filter((i) => i.lifecycle === 'InService').map((i) => i.id);
  // A selected server that leaves service (terminating, gone) falls back to the average.
  const inService = (id: string) => serving.includes(id);
  // With one server its report is the average, so there is nothing to pick.
  const canPick = asg.inService > 1;
  const server = canPick && selected && inService(selected) && metrics.byInstance[selected] ? selected : null;
  // CloudWatch where nothing better exists, the Defenders' 15 s steps, then 1 s points (lib/live-merge.ts).
  // A server's own steps are complete; the group's only from when the Watcher saw every server.
  const joined = server
    ? joinSources({ cloudwatch: metrics.byInstance[server], steps: live.steps[server], seconds: live.seconds[server] })
    : joinSources({
        cloudwatch: metrics,
        steps: groupPoints(live.steps),
        seconds: groupPoints(live.seconds),
        stepsFrom: live.stepsFrom,
      });
  const view = joined.metrics;
  // Where the 1 s part starts: the charts draw it wider.
  const liveFrom = joined.liveFrom;
  // Every chart and sparkline uses CloudWatch's history length, so the average and
  // a server that just started share one time scale. Whole minutes: it must not
  // grow with every live second, or each chart would resize every second.
  const cw = metrics.cpu;
  const historyMs = cw.length > 1 ? Math.max(Math.round((cw[cw.length - 1].t - cw[0].t) / 60_000), 1) * 60_000 : undefined;
  const short = server ? `${server.slice(0, 10)}…` : '';

  const cpu = last(view.cpu)?.v ?? 0;
  const reqs = last(view.requests)?.v ?? 0;
  const latency = last(view.latencyMs)?.v ?? 0;
  const errors = last(view.errors5xx)?.v ?? 0;

  const cpuSeverity: Severity = cpu >= DANGER_CPU ? 'crit' : cpu > targetCpu ? 'warn' : 'ok';
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
          watcher unreachable at {watcherOrigin()} — showing a local simulation.
          {WATCHER_URL.includes('localhost') && (
            <> Start it with <code className="text-ink">npm run dev:watcher</code>.</>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel title="Capacity" tag={`asg:${asg.name}`} className="lg:col-span-4">
          <Capacity asg={asg} instances={instances} selected={server} canPick={canPick} onSelect={setSelected} />
        </Panel>

        <div className="grid grid-cols-2 gap-4 lg:col-span-8">
          <StatTile
            label={server ? <>CPU · <span className="normal-case">{short}</span></> : 'Avg CPU'}
            value={cpu.toFixed(1)}
            unit="%"
            color="var(--color-accent)"
            severity={cpuSeverity}
            trend={view.cpu}
            historyMs={historyMs}
            note={cpuSeverity === 'ok' ? `under target ${targetCpu}%` : `over target ${targetCpu}%${server ? '' : ' · scaling out'}`}
          />
          <StatTile
            label={server ? <>Requests · <span className="normal-case">{short}</span></> : 'Requests'}
            value={fmtCompact(reqs)}
            unit="/min"
            color="var(--color-cyan)"
            severity="ok"
            trend={view.requests}
            historyMs={historyMs}
            note={server ? 'handled by this server' : `${fmtInt(reqs / Math.max(asg.inService, 1))} per instance`}
          />
          <StatTile
            label={server ? <>Latency · <span className="normal-case">{short}</span></> : 'Latency'}
            value={fmtInt(latency)}
            unit="ms"
            color="var(--color-violet)"
            severity={latencySeverity}
            trend={view.latencyMs}
            historyMs={historyMs}
            note={latencySeverity === 'ok' ? 'response time ok' : 'responses getting slow'}
          />
          <StatTile
            label={server ? <>5xx · <span className="normal-case">{short}</span></> : '5xx errors'}
            value={fmtInt(errors)}
            unit="/min"
            color="var(--color-crit)"
            severity={errorSeverity}
            trend={view.errors5xx}
            historyMs={historyMs}
            note={errorSeverity === 'ok' ? 'no error spike' : server ? 'this server is overloaded' : 'instances overloaded'}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border border-cyan/40 bg-cyan/5 px-4 py-2 text-xs text-cyan">
        <div className="flex items-center gap-2">
          <span aria-hidden>▸</span>
          showing
          <ServerPicker instances={instances} selected={server} canPick={canPick} onSelect={setSelected} />
        </div>
        <button
          onClick={() => setSelected(null)}
          disabled={!server}
          className="text-ink-2 underline-offset-2 enabled:hover:text-ink enabled:hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:opacity-50"
        >
          back to average
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:col-span-8">
          <Panel title="CPU utilization" tag={server ? `AWS/EC2 · CPUUtilization · ${short}` : 'AWS/EC2 · CPUUtilization · avg'}>
            <LineChart
              points={view.cpu}
              liveFrom={liveFrom}
              color="var(--color-accent)"
              label={server ? `CPU utilization of ${server}` : 'Average CPU utilization'}
              format={(v) => `${v.toFixed(1)}%`}
              yMax={100}
              historyMs={historyMs}
              view={chartView}
              onViewChange={setChartView}
              thresholds={[
                { value: targetCpu, label: `target ${targetCpu}%` },
                { value: DANGER_CPU, label: `danger ${DANGER_CPU}%`, color: 'var(--color-crit)' },
              ]}
            />
          </Panel>
          <Panel title="Request rate" tag={server ? `LoadForge · RequestCount · ${short}` : 'AWS/ApplicationELB · RequestCount'}>
            <LineChart
              points={view.requests}
              liveFrom={liveFrom}
              color="var(--color-cyan)"
              label="Requests per minute"
              format={(v) => `${fmtInt(v)} req/min`}
              historyMs={historyMs}
              view={chartView}
              onViewChange={setChartView}
            />
          </Panel>
          <Panel title="Response time" tag={server ? `LoadForge · Latency · ${short}` : 'AWS/ApplicationELB · TargetResponseTime'}>
            <LineChart
              points={view.latencyMs}
              liveFrom={liveFrom}
              color="var(--color-violet)"
              label="Response time"
              format={(v) => `${fmtInt(v)} ms`}
              historyMs={historyMs}
              view={chartView}
              onViewChange={setChartView}
            />
          </Panel>
          <Panel title="5xx errors" tag={server ? `LoadForge · Http5xxCount · ${short}` : 'AWS/ApplicationELB · HTTPCode_Target_5XX'}>
            <LineChart
              points={view.errors5xx}
              liveFrom={liveFrom}
              color="var(--color-crit)"
              label="5xx errors per minute"
              format={(v) => `${fmtInt(v)} /min`}
              historyMs={historyMs}
              view={chartView}
              onViewChange={setChartView}
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
        <Panel title="Instances" tag="autoscaling:DescribeAutoScalingGroups" className={testActive ? "xl:col-span-6" : "xl:col-span-7"}>
          <InstanceTable instances={instances} now={now} selected={server} canPick={canPick} onSelect={setSelected} />
        </Panel>
        <Panel title="Load test" tag="GET /api/load/cpu" className={testActive ? "xl:col-span-6" : "xl:col-span-5"}>
          <LoadRoutes onActiveChange={setTestActive} />
        </Panel>
      </div>

      <footer className="flex flex-wrap justify-between gap-2 border-t border-line pt-3 text-[10px] tracking-wider text-muted uppercase">
        <span>loadforge v0.1 · source {snapshot.source} · period {metrics.periodSec}s</span>
        <span className="tabular-nums">last update {fmtTime(snapshot.ts)} {TZ_LABEL}</span>
      </footer>
    </main>
  );
}
