export interface LoadRoute {
  key: 'cpu' | 'memory' | 'io';
  name: string;
  bound: string;
  path: string;
  query: string;
  /** what one request does on the server */
  work: string;
  /** what to watch on the dashboard while it runs */
  expect: string;
}

export const LOAD_ROUTES: LoadRoute[] = [
  {
    key: 'cpu',
    name: 'Prime sieve',
    bound: 'CPU',
    path: '/api/load/cpu',
    query: 'limit=300000',
    work: 'Counts every prime number up to 300,000. About 30 ms of pure CPU per request, and the server can do nothing else meanwhile.',
    expect: 'CPU climbs. Past the 60% target for a few minutes, the alarm fires and the ASG adds servers. When you stop, it removes them again (~15 min).',
  },
  {
    key: 'memory',
    name: 'Array crunch',
    bound: 'MEMORY',
    path: '/api/load/memory',
    query: 'size=500000',
    work: 'Creates 500,000 random numbers, sorts them and hashes the result. Fills the heap, so the garbage collector has to work hard.',
    expect: 'Response time goes up first. CPU rises too, because sorting is also CPU work.',
  },
  {
    key: 'io',
    name: 'Slow downstream',
    bound: 'LATENCY',
    path: '/api/load/io',
    query: 'delay=300',
    work: 'Waits 300 ms, like a slow database or outside API. Uses almost no CPU while waiting.',
    expect: 'Response time goes up but CPU stays low, so CPU-based scaling does NOT add servers. Scaling on the wrong metric does not help.',
  },
];
