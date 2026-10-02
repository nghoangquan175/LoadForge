import type { AttackerConfig } from './config.js';
import { checkPlan } from './plan.js';

const config = { maxRate: 1000, maxDurationSec: 1800 } as AttackerConfig;
const ok = (r: ReturnType<typeof checkPlan>) => ('plan' in r ? r.plan : r.error);

describe('checkPlan', () => {
  it('accepts a plan in range and rounds it', () => {
    expect(ok(checkPlan({ rate: 50.4, durationSec: 300 }, config))).toEqual({ rate: 50, durationSec: 300 });
  });

  it('refuses a bad shape', () => {
    expect(ok(checkPlan(null, config))).toMatch(/JSON object/);
    expect(ok(checkPlan({ rate: 0, durationSec: 10 }, config))).toMatch(/rate must be/);
    expect(ok(checkPlan({ rate: 10, durationSec: -1 }, config))).toMatch(/durationSec must be/);
  });

  it('refuses over the ceilings instead of clamping', () => {
    expect(ok(checkPlan({ rate: 5000, durationSec: 60 }, config))).toMatch(/at most 1000/);
    expect(ok(checkPlan({ rate: 10, durationSec: 99999 }, config))).toMatch(/at most 1800/);
  });
});
