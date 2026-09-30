import type { AsgSummary, Ec2Instance, InstanceLifecycle } from '@/lib/types';

type SlotState = 'inService' | 'pending' | 'terminating' | 'empty';

const SLOT_STYLE: Record<SlotState, string> = {
  inService: 'bg-accent shadow-[0_0_10px_rgb(34_229_132/0.45)]',
  pending: 'stripes border border-cyan/70 animate-pulse',
  terminating: 'border border-crit bg-crit/20',
  empty: 'border border-line bg-panel-2',
};

const SLOT_OF: Partial<Record<InstanceLifecycle, SlotState>> = {
  InService: 'inService',
  Pending: 'pending',
  Terminating: 'terminating',
};

const SLOT_ORDER: SlotState[] = ['inService', 'pending', 'terminating'];

interface CapacityProps {
  asg: AsgSummary;
  instances: Ec2Instance[];
  /** instance id whose report is shown, null = average of all */
  selected: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * Hero figure: running instances plus a min / desired / max capacity strip.
 * Each box is a server: click it for that server's report, click "average"
 * (or the same box again) to go back to the whole group.
 */
export function Capacity({ asg, instances, selected, onSelect }: CapacityProps) {
  const slots: { state: SlotState; instance?: Ec2Instance }[] = instances
    .filter((i) => SLOT_OF[i.lifecycle])
    .sort(
      (a, b) =>
        SLOT_ORDER.indexOf(SLOT_OF[a.lifecycle]!) - SLOT_ORDER.indexOf(SLOT_OF[b.lifecycle]!) ||
        a.launchedAt - b.launchedAt,
    )
    .map((instance) => ({ state: SLOT_OF[instance.lifecycle]!, instance }));
  while (slots.length < asg.max) slots.push({ state: 'empty' });

  const onAverage = selected === null;
  const averageDisabled = asg.inService <= 1;

  return (
    <div className="flex h-full flex-col justify-between gap-5">
      <div className="flex items-end justify-between gap-4">
        <div className="flex items-end gap-4">
          <div className="glow text-7xl leading-none font-bold text-accent tabular-nums">
            {String(asg.inService).padStart(2, '0')}
          </div>
          <div className="pb-1.5 text-xs leading-5 text-ink-2">
            <div>EC2 instances</div>
            <div className="text-muted">in service · max {asg.max}</div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onSelect(null)}
          disabled={averageDisabled}
          aria-pressed={onAverage}
          title={averageDisabled ? 'Only one server is running: its report is the average' : 'Report for all servers together'}
          className={`mb-1 border px-3 py-1.5 text-xs font-semibold tracking-wider transition-colors disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-muted ${
            onAverage
              ? 'border-accent/70 bg-accent/10 text-accent'
              : 'border-line text-ink-2 hover:border-accent/50 hover:text-ink'
          }`}
        >
          <span aria-hidden>◎ </span>average
        </button>
      </div>

      <div>
        <div className="flex gap-1.5">
          {slots.map(({ state, instance }, i) => {
            const isSelected = !!instance && instance.id === selected;
            return (
              <div key={instance?.id ?? `empty-${i}`} className="relative flex-1">
                {/* Only in-service servers are clickable; pending / terminating are not. */}
                {instance && state === 'inService' ? (
                  <button
                    type="button"
                    onClick={() => onSelect(isSelected ? null : instance.id)}
                    aria-pressed={isSelected}
                    aria-label={`${instance.id}, ${instance.lifecycle}${isSelected ? ', showing its report' : ', show its report'}`}
                    title={`${instance.id} · ${instance.lifecycle}${instance.cpu !== null ? ` · ${instance.cpu.toFixed(1)}% CPU` : ''}`}
                    className={`block h-9 w-full cursor-pointer rounded-[3px] transition-all duration-500 outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ink/70 ${SLOT_STYLE[state]} ${
                      isSelected ? 'ring-2 ring-cyan ring-offset-2 ring-offset-panel' : ''
                    }`}
                  />
                ) : (
                  <div
                    title={instance ? `${instance.id} · ${instance.lifecycle}` : undefined}
                    className={`h-9 rounded-[3px] transition-all duration-500 ${SLOT_STYLE[state]}`}
                  />
                )}
                <div className={`mt-1 text-center text-[10px] tabular-nums ${isSelected ? 'text-cyan' : 'text-muted'}`}>
                  {isSelected ? '▲' : i + 1}
                </div>
                {i + 1 === asg.min && (
                  <div className="absolute -top-4 left-0 text-[9px] text-muted uppercase">min</div>
                )}
                {i + 1 === asg.desired && (
                  <div className="absolute -top-4 right-0 text-[9px] text-cyan uppercase">desired</div>
                )}
              </div>
            );
          })}
        </div>

        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-2">
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-accent" />in service {asg.inService}</li>
          <li className="flex items-center gap-1.5"><span className="stripes size-2.5 rounded-[2px] border border-cyan/70" />pending {asg.pending}</li>
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] border border-crit bg-crit/20" />terminating {asg.terminating}</li>
          <li className="text-muted">click a green box for its report</li>
        </ul>
      </div>

      <dl className="grid grid-cols-3 border-t border-line pt-3 text-center">
        {([['min', asg.min], ['desired', asg.desired], ['max', asg.max]] as const).map(([k, v]) => (
          <div key={k}>
            <dt className="text-[10px] tracking-widest text-muted uppercase">{k}</dt>
            <dd className="text-lg font-semibold text-ink tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
