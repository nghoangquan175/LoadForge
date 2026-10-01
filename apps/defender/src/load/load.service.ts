import { Injectable } from '@nestjs/common';

/**
 * Deliberately expensive work for load testing. It runs synchronously and
 * blocks the event loop on purpose: that is what makes a single instance
 * saturate and forces the ASG to scale out.
 */
@Injectable()
export class LoadService {
  /** Counts primes <= limit by trial division. */
  countPrimes(limit: number): number {
    if (limit < 2) return 0;
    let count = 1; // 2
    for (let n = 3; n <= limit; n += 2) {
      let prime = true;
      for (let d = 3; d * d <= n; d += 2) {
        if (n % d === 0) {
          prime = false;
          break;
        }
      }
      if (prime) count++;
    }
    return count;
  }
}
