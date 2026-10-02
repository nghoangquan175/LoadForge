import { memo } from 'react';
import { fmtDayTime } from '@/lib/format';
import type { ActivityKind, ActivityStatus, ScalingActivity } from '@/lib/types';

const KIND_STYLE: Record<ActivityKind, string> = {
  LAUNCH: 'text-accent',
  TERMINATE: 'text-crit',
  ALARM: 'text-warn',
  INFO: 'text-cyan',
};

const STATUS: Record<ActivityStatus, { icon: string; className: string }> = {
  Successful: { icon: '✔', className: 'text-ink-2' },
  InProgress: { icon: '…', className: 'text-cyan' },
  Failed: { icon: '✖', className: 'text-crit' },
};

/** Terminal-style feed of Auto Scaling activities, newest first. */
// Memo: the dashboard re-renders every second for live data; the log only changes with a snapshot.
export const ActivityLog = memo(function ActivityLog({ activities }: { activities: ScalingActivity[] }) {
  return (
    <div className="flex h-full flex-col rounded-[3px] border border-line bg-bg/80 text-[11.5px] leading-relaxed">
      <div className="border-b border-line px-3 py-2 text-muted">
        <span className="text-accent">root@loadforge</span>:<span className="text-cyan">~</span>$ tail -f /var/log/asg/activity
        <span className="animate-blink text-accent"> ▌</span>
      </div>
      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {activities.length === 0 && <li className="text-muted">no scaling activity yet_</li>}
        {activities.map((a) => {
          const st = STATUS[a.status];
          return (
            // Full AWS cause text stays available on hover.
            <li key={a.id} title={a.cause} className="grid animate-slide-in grid-cols-[max-content_1fr] gap-x-3">
              <span className="text-muted tabular-nums">{fmtDayTime(a.time)}</span>
              <span className="flex flex-wrap gap-x-2">
                <span className={`w-[5.5rem] shrink-0 font-semibold ${KIND_STYLE[a.kind]}`}>[{a.kind}]</span>
                <span className={st.className}>
                  <span aria-hidden>{st.icon} </span>
                  {a.status}
                </span>
              </span>
              <span className="col-start-2 text-ink">{a.description}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
});
