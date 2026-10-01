import { LoadService } from './load.service.js';

describe('LoadService', () => {
  const load = new LoadService();

  it('counts primes', () => {
    expect(load.countPrimes(1)).toBe(0);
    expect(load.countPrimes(2)).toBe(1);
    expect(load.countPrimes(100)).toBe(25);
    expect(load.countPrimes(100_000)).toBe(9592);
  });
});
