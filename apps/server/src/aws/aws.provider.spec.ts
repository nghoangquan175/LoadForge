import { toActivity, toLifecycle } from './aws.provider.js';

describe('AWS mapping', () => {
  it('maps lifecycle states', () => {
    expect(toLifecycle('Pending:Wait')).toBe('Pending');
    expect(toLifecycle('InService')).toBe('InService');
    expect(toLifecycle('Terminating:Proceed')).toBe('Terminating');
    expect(toLifecycle('Terminated')).toBe('Terminated');
    expect(toLifecycle('Standby')).toBe('Standby');
  });

  it('maps scaling activities', () => {
    const a = toActivity({
      ActivityId: 'a1',
      AutoScalingGroupName: 'lf',
      Description: 'Launching a new EC2 instance: i-0123456789abcdef0',
      Cause: 'alarm AlarmHigh in state ALARM',
      StartTime: new Date(1000),
      StatusCode: 'Successful',
    });
    expect(a).toMatchObject({ id: 'a1', kind: 'LAUNCH', status: 'Successful', instanceId: 'i-0123456789abcdef0', time: 1000 });
    expect(toActivity({ ActivityId: 'a2', AutoScalingGroupName: 'lf', Cause: '', StartTime: new Date(), StatusCode: 'Cancelled', Description: 'Terminating EC2 instance: i-0abc12345' }))
      .toMatchObject({ kind: 'TERMINATE', status: 'Failed' });
  });
});
