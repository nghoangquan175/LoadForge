import { LoadService } from './load.service.js';

describe('LoadService', () => {
  const load = new LoadService();

  it('counts primes', () => {
    expect(load.countPrimes(1)).toBe(0);
    expect(load.countPrimes(2)).toBe(1);
    expect(load.countPrimes(100)).toBe(25);
    expect(load.countPrimes(100_000)).toBe(9592);
  });

  it('sorts and hashes the array', () => {
    const r = load.crunchArray(1000);
    expect(r.min).toBeLessThanOrEqual(r.median!);
    expect(r.median).toBeLessThanOrEqual(r.max!);
    expect(r.sha256).toMatch(/^[0-9a-f]{16}$/);
  });

  it('waits for the slow downstream', async () => {
    const started = Date.now();
    await expect(load.slowDownstream(50)).resolves.toEqual({ waitedMs: 50 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
  });
});
