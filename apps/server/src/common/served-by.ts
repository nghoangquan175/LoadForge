import { hostname } from 'node:os';

/** Which machine answered. Behind a load balancer this changes per request. */
export const SERVED_BY = process.env.INSTANCE_ID || hostname();
