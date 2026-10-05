// LoadForge attacker script. Run by the attacker service, never by hand in prod:
// the service fills TARGET from its fixed config, so load only ever hits the
// LoadForge system this box was deployed for.
//
// Holds a steady request rate (constant-arrival-rate), like a real traffic
// surge: it keeps sending at RATE even when the target slows down, so the
// Defenders' CPU climbs and the Auto Scaling group has to react.
import http from 'k6/http';
import { check } from 'k6';

const TARGET = __ENV.TARGET;
const RATE = Number(__ENV.RATE || 10);
const DURATION = __ENV.DURATION || '5m';
const MAX_VUS = Number(__ENV.MAX_VUS || 500);

if (!TARGET) throw new Error('TARGET is required (set by the attacker service)');

// A constant arrival rate needs about `rate x latency` VUs in flight. Starting
// at 50 and growing makes k6 drop iterations during the ramp even when the box
// could hold the rate, so pre-allocate ~1 VU per req/s (enough while the target
// is fast) and let k6 grow to MAX_VUS as the target slows. Past MAX_VUS, k6
// reports dropped_iterations rather than allocating without bound.
const preAllocatedVUs = Math.min(MAX_VUS, Math.max(50, RATE));

export const options = {
  scenarios: {
    surge: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs,
      maxVUs: MAX_VUS,
    },
  },
};

export default function () {
  const res = http.get(TARGET);
  check(res, { 'status 200': (r) => r.status === 200 });
}
