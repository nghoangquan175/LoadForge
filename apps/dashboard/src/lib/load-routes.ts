/** The one load test target: pure CPU work, which is what the ASG scales on. */
export const LOAD_ROUTE = {
  path: '/api/load/cpu',
  query: 'limit=300000',
};
