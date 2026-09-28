export interface LoadRoute {
  key: 'cpu' | 'memory' | 'io';
  name: string;
  bound: string;
  path: string;
  query: string;
  params: { name: string; hint: string }[];
  description: string;
  lesson: string;
}

export const LOAD_ROUTES: LoadRoute[] = [
  {
    key: 'cpu',
    name: 'Prime sieve',
    bound: 'CPU',
    path: '/api/load/cpu',
    query: 'limit=300000',
    params: [{ name: 'limit', hint: 'count primes up to N (max 5,000,000)' }],
    description: 'Counts prime numbers up to `limit` by trial division. Pure CPU work on the event loop.',
    lesson: 'CPU climbs past target, the alarm fires, the ASG scales out.',
  },
  {
    key: 'memory',
    name: 'Array crunch',
    bound: 'MEMORY',
    path: '/api/load/memory',
    query: 'size=500000',
    params: [{ name: 'size', hint: 'random numbers to allocate and sort (max 5,000,000)' }],
    description: 'Allocates `size` random numbers, sorts them and hashes the result. Heavy on heap and GC.',
    lesson: 'Watch memory pressure and GC pauses push latency up before CPU does.',
  },
  {
    key: 'io',
    name: 'Slow downstream',
    bound: 'LATENCY',
    path: '/api/load/io',
    query: 'delay=300',
    params: [{ name: 'delay', hint: 'ms to wait on a fake DB/API call (max 10,000)' }],
    description: 'Waits `delay` ms on a fake downstream call. Almost no CPU, but every request is slow.',
    lesson: 'Latency goes up, CPU stays low: CPU-based scaling will NOT help here.',
  },
];

export function k6Script(route: LoadRoute): string {
  return `import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 50 },   // warm up
    { duration: '3m', target: 200 },  // push past target CPU
    { duration: '1m', target: 0 },    // cool down, watch scale-in
  ],
  thresholds: { http_req_duration: ['p(95)<800'] },
};

export default function () {
  const res = http.get(\`\${__ENV.BASE_URL}${route.path}?${route.query}\`);
  check(res, { 'status 200': (r) => r.status === 200 });
  sleep(0.5);
}
`;
}
