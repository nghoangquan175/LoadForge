// Fake auto-scaling group used when the server is offline.
// It follows the same rules a real target-tracking policy does, so the
// dashboard shows believable scale-out / scale-in behavior.
// Keep in sync with apps/server/src/aws/mock-simulator.ts.

import type {
  ActivityKind,
  ActivityStatus,
  DashboardSnapshot,
  Ec2Instance,
  InstanceMetrics,
  MetricPoint,
  ScalingActivity,
} from './types';

export const SIM_PERIOD_MS = 2000;

const WINDOW = 90;
const REGION = 'ap-southeast-1';
const AZS = ['ap-southeast-1a', 'ap-southeast-1b'];
const ASG_NAME = 'loadforge-asg';
const INSTANCE_TYPE = 't3.micro';
const MIN = 1;
const MAX = 6;
const TARGET_CPU = 60;
/** requests/min one instance can serve at 100% CPU */
const CAPACITY_PER_INSTANCE = 1800;
const WARMUP_TICKS = 6;
const DRAIN_TICKS = 3;
const COOLDOWN_TICKS = 5;

interface SimInstance extends Ec2Instance {
  readyTick: number;
  goneTick?: number;
  history: InstanceMetrics;
}

export interface SimState {
  tick: number;
  now: number;
  seq: number;
  instances: SimInstance[];
  cpu: MetricPoint[];
  requests: MetricPoint[];
  latencyMs: MetricPoint[];
  errors5xx: MetricPoint[];
  activities: ScalingActivity[];
  highTicks: number;
  lowTicks: number;
  cooldownUntil: number;
  surgeStart: number;
  surgeUntil: number;
  nextSurge: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const randInt = (a: number, b: number) => Math.floor(rand(a, b));
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const hex = (n: number) =>
  Array.from({ length: n }, () => randInt(0, 16).toString(16)).join('');

function log(
  s: SimState,
  kind: ActivityKind,
  status: ActivityStatus,
  description: string,
  instanceId?: string,
  cause?: string,
) {
  s.activities.unshift({
    id: `act-${++s.seq}`,
    time: s.now,
    kind,
    status,
    instanceId,
    description,
    cause,
  });
  if (s.activities.length > 60) s.activities.length = 60;
}

function pickAz(s: SimState): string {
  const counts = AZS.map(
    (az) => s.instances.filter((i) => i.az === az && i.lifecycle !== 'Terminating').length,
  );
  return AZS[counts.indexOf(Math.min(...counts))];
}

function makeInstance(s: SimState, lifecycle: 'Pending' | 'InService', launchedAt: number): SimInstance {
  return {
    id: `i-0${hex(16)}`,
    type: INSTANCE_TYPE,
    az: pickAz(s),
    lifecycle,
    health: 'Healthy',
    launchedAt,
    cpu: null,
    privateIp: `10.0.${randInt(1, 3)}.${randInt(10, 250)}`,
    readyTick: s.tick + WARMUP_TICKS,
    history: { cpu: [], requests: [], latencyMs: [], errors5xx: [] },
  };
}

const latencyAt = (cpu: number) => 35 + 600 * (cpu / 100) ** 4 + rand(-5, 5);
const errorsAt = (cpu: number, reqs: number) =>
  cpu > 88 ? reqs * ((cpu - 88) / 100) * 0.5 : Math.random() < 0.1 ? 1 : 0;

function launch(s: SimState, cause: string) {
  const inst = makeInstance(s, 'Pending', s.now);
  s.instances.push(inst);
  log(s, 'LAUNCH', 'InProgress', `Launching a new EC2 instance: ${inst.id}`, inst.id, cause);
}

function terminate(s: SimState, inst: SimInstance, cause: string) {
  inst.lifecycle = 'Terminating';
  inst.goneTick = s.tick + DRAIN_TICKS;
  log(s, 'TERMINATE', 'InProgress', `Terminating EC2 instance: ${inst.id}`, inst.id, cause);
}

function push(series: MetricPoint[], t: number, v: number) {
  series.push({ t, v });
  if (series.length > WINDOW) series.shift();
}

export function stepSim(s: SimState, now: number) {
  s.tick++;
  s.now = now;

  // Lifecycle transitions. Iterate a copy: finished instances are spliced out.
  for (const inst of s.instances.slice()) {
    if (inst.lifecycle === 'Pending' && s.tick >= inst.readyTick) {
      inst.lifecycle = 'InService';
      log(s, 'LAUNCH', 'Successful', `Instance ${inst.id} is InService`, inst.id, 'passed ELB health checks');
    } else if (inst.lifecycle === 'Terminating' && inst.goneTick !== undefined && s.tick >= inst.goneTick) {
      s.instances.splice(s.instances.indexOf(inst), 1);
      log(s, 'TERMINATE', 'Successful', `Instance ${inst.id} terminated`, inst.id, 'connection draining complete');
    }
  }

  // Traffic: slow wave plus a periodic surge, like someone running k6.
  if (s.tick >= s.nextSurge) {
    s.surgeStart = s.tick;
    s.surgeUntil = s.tick + randInt(30, 50);
    s.nextSurge = s.tick + randInt(120, 180);
    log(s, 'INFO', 'Successful', 'Traffic surge detected: k6 ramping to 200 VUs', undefined, 'simulated load test');
  }
  const surgeRamp = s.tick < s.surgeUntil ? Math.min(1, (s.tick - s.surgeStart + 1) / 5) : 0;
  const reqs = Math.max(
    0,
    700 + 450 * Math.sin((s.tick / 90) * 2 * Math.PI) + rand(-80, 80) + 3200 * surgeRamp,
  );

  // CPU per instance follows its share of traffic.
  const serving = s.instances.filter((i) => i.lifecycle === 'InService' && i.health === 'Healthy');
  const perInstance = reqs / Math.max(serving.length, 1);
  for (const inst of s.instances) {
    if (inst.lifecycle === 'InService') {
      inst.cpu = inst.health === 'Healthy'
        ? round1(clamp(3 + (perInstance / CAPACITY_PER_INSTANCE) * 100 * rand(0.88, 1.12), 1, 100))
        : round1(rand(95, 100));
    } else if (inst.lifecycle === 'Pending') {
      inst.cpu = round1(rand(20, 45));
    } else {
      inst.cpu = round1(rand(1, 5));
    }
  }
  const avgCpu = serving.length
    ? serving.reduce((sum, i) => sum + (i.cpu ?? 0), 0) / serving.length
    : 0;
  const latency = serving.length ? latencyAt(avgCpu) : 0;
  const errors = serving.length ? errorsAt(avgCpu, reqs) : reqs;

  push(s.cpu, now, round1(avgCpu));
  push(s.requests, now, Math.round(reqs));
  push(s.latencyMs, now, Math.round(latency));
  push(s.errors5xx, now, Math.round(errors));

  // Each server's own view: only healthy in-service ones get traffic.
  for (const inst of s.instances) {
    const gets = serving.includes(inst) ? perInstance : 0;
    const h = inst.history;
    push(h.cpu, now, inst.cpu ?? 0);
    push(h.requests, now, Math.round(gets));
    push(h.latencyMs, now, gets ? Math.round(latencyAt(inst.cpu ?? 0)) : 0);
    push(h.errors5xx, now, gets ? Math.round(errorsAt(inst.cpu ?? 0, gets)) : 0);
  }

  // Now and then an instance fails its health check and gets replaced.
  if (serving.length > 1 && Math.random() < 0.004) {
    const victim = serving[randInt(0, serving.length)];
    victim.health = 'Unhealthy';
    log(s, 'ALARM', 'Failed', `Instance ${victim.id} failed ELB health check`, victim.id, 'HTTP 502 on /api/health');
    terminate(s, victim, 'replacing unhealthy instance');
    launch(s, 'replacing unhealthy instance');
  }

  // Target tracking policy.
  const active = s.instances.filter((i) => i.lifecycle === 'Pending' || i.lifecycle === 'InService').length;
  s.highTicks = avgCpu > TARGET_CPU ? s.highTicks + 1 : 0;
  s.lowTicks = avgCpu < TARGET_CPU * 0.45 ? s.lowTicks + 1 : 0;

  if (active < MIN) {
    launch(s, `desired capacity below minimum (${MIN})`);
  } else if (s.tick >= s.cooldownUntil) {
    if (s.highTicks >= 3 && active < MAX) {
      const wanted = clamp(Math.ceil((active * avgCpu) / TARGET_CPU), active + 1, MAX);
      log(s, 'ALARM', 'Successful', `TargetTracking-AlarmHigh: CPUUtilization > ${TARGET_CPU}% for 3 datapoints`, undefined, `avg CPU ${round1(avgCpu)}%`);
      for (let i = active; i < wanted; i++) {
        launch(s, `changing desired capacity from ${active} to ${wanted}`);
      }
      s.cooldownUntil = s.tick + COOLDOWN_TICKS;
      s.highTicks = 0;
    } else if (s.lowTicks >= 10 && active > MIN) {
      const newest = serving.sort((a, b) => b.launchedAt - a.launchedAt)[0];
      if (newest) {
        log(s, 'ALARM', 'Successful', `TargetTracking-AlarmLow: CPUUtilization < ${Math.round(TARGET_CPU * 0.45)}% for 10 datapoints`, undefined, `avg CPU ${round1(avgCpu)}%`);
        terminate(s, newest, `changing desired capacity from ${active} to ${active - 1}`);
        s.cooldownUntil = s.tick + COOLDOWN_TICKS;
        s.lowTicks = 0;
      }
    }
  }
}

export function createSim(now: number): SimState {
  const start = now - WINDOW * SIM_PERIOD_MS;
  const s: SimState = {
    tick: 0,
    now: start,
    seq: 0,
    instances: [],
    cpu: [],
    requests: [],
    latencyMs: [],
    errors5xx: [],
    activities: [],
    highTicks: 0,
    lowTicks: 0,
    cooldownUntil: 0,
    surgeStart: 0,
    surgeUntil: 0,
    nextSurge: 25,
  };
  for (let i = 0; i < 2; i++) {
    s.instances.push(makeInstance(s, 'InService', start - randInt(2, 6) * 3_600_000));
  }
  // Backfill history so charts are full on first paint.
  for (let i = 1; i <= WINDOW; i++) stepSim(s, start + i * SIM_PERIOD_MS);
  return s;
}

export function toSnapshot(s: SimState): DashboardSnapshot {
  // Wire shape only: drop sim bookkeeping (readyTick, history, ...).
  const instances: Ec2Instance[] = s.instances.map((i) => ({
    id: i.id,
    type: i.type,
    az: i.az,
    lifecycle: i.lifecycle,
    health: i.health,
    launchedAt: i.launchedAt,
    cpu: i.cpu,
    privateIp: i.privateIp,
  }));
  const count = (l: Ec2Instance['lifecycle']) => instances.filter((i) => i.lifecycle === l).length;
  return {
    ts: s.now,
    source: 'mock',
    region: REGION,
    asg: {
      name: ASG_NAME,
      min: MIN,
      max: MAX,
      desired: count('Pending') + count('InService'),
      inService: count('InService'),
      pending: count('Pending'),
      terminating: count('Terminating'),
    },
    targetCpu: TARGET_CPU,
    instances,
    metrics: {
      periodSec: SIM_PERIOD_MS / 1000,
      cpu: [...s.cpu],
      requests: [...s.requests],
      latencyMs: [...s.latencyMs],
      errors5xx: [...s.errors5xx],
      byInstance: Object.fromEntries(
        s.instances.map((i) => [
          i.id,
          {
            cpu: [...i.history.cpu],
            requests: [...i.history.requests],
            latencyMs: [...i.history.latencyMs],
            errors5xx: [...i.history.errors5xx],
          },
        ]),
      ),
    },
    activities: [...s.activities],
  };
}
