import { workerCount } from './workers.js';

describe('workerCount', () => {
  it('defaults to one process', () => {
    expect(workerCount(undefined, 2)).toBe(1);
    expect(workerCount('nope', 2)).toBe(1);
    expect(workerCount('0', 2)).toBe(1);
  });

  it('takes a number or one per vCPU', () => {
    expect(workerCount('3', 2)).toBe(3);
    expect(workerCount('auto', 2)).toBe(2);
  });
});
