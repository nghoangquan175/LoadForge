/** The one load test target: pure CPU work, which is what the ASG scales on. */
export const LOAD_ROUTE = {
  path: '/api/load/cpu',
  query: 'limit=300000',
  work: 'Counts every prime number up to 300,000. About 30 ms of pure CPU per request, and the server can do nothing else meanwhile.',
  expect: 'CPU climbs. Past the 60% target for 3 minutes, the alarm fires and the ASG adds servers. When you stop, it removes them again (~15 min).',
};
