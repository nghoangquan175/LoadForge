import type { AsgSummary, Ec2Instance } from '@/lib/types';

type SlotState = 'inService' | 'pending' | 'terminating' | 'empty';

const SLOT_STYLE: Record<SlotState, string> = {
  inService: 'bg-accent shadow-[0_0_10px_rgb(34_229_132/0.45)]',
  pending: 'stripes border border-cyan/70 animate-pulse',
  terminating: 'border border-crit bg-crit/20',
  empty: 'border border-line bg-panel-2',
};

interface CapacityProps {
  asg: AsgSummary;
  instances: Ec2Instance[];
  /** instance id whose report is shown, null = average of all */
  selected: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * Hero figure: running instances plus a min / desired / max capacity strip,
 * and the switch between the group average and one server's report.
 */
export function Capacity({ asg, instances, selected, onSelect }: CapacityProps) {
  const slots: SlotState[] = [
    ...Array<SlotState>(asg.inService).fill('inService'),
    ...Array<SlotState>(asg.pending).fill('pending'),
    ...Array<SlotState>(asg.terminating).fill('terminating'),
  ];
  const total = Math.max(asg.max, slots.length);
  while (slots.length < total) slots.push('empty');

  return (
    <div className="flex h-full flex-col justify-between gap-5">
      <div className="flex items-end gap-4">
        <div className="glow text-7xl leading-none font-bold text-accent tabular-nums">
          {String(asg.inService).padStart(2, '0')}
        </div>
        <div className="pb-1.5 text-xs leading-5 text-ink-2">
          <div>EC2 instances</div>
          <div className="text-muted">in service · max {asg.max}</div>
        </div>
      </div>

      <div>
        <div className="flex gap-1.5" role="img" aria-label={`${asg.inService} in service, ${asg.pending} pending, ${asg.terminating} terminating, capacity ${asg.max}`}>
          {slots.map((state, i) => (
            <div key={i} className="relative flex-1">
              <div className={`h-9 rounded-[3px] transition-all duration-500 ${SLOT_STYLE[state]}`} />
              <div className="mt-1 text-center text-[10px] text-muted tabular-nums">{i + 1}</div>
              {i + 1 === asg.min && (
                <div className="absolute -top-4 left-0 text-[9px] text-muted uppercase">min</div>
              )}
              {i + 1 === asg.desired && (
                <div className="absolute -top-4 right-0 text-[9px] text-cyan uppercase">desired</div>
              )}
            </div>
          ))}
        </div>

        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-2">
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-accent" />in service {asg.inService}</li>
          <li className="flex items-center gap-1.5"><span className="stripes size-2.5 rounded-[2px] border border-cyan/70" />pending {asg.pending}</li>
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] border border-crit bg-crit/20" />terminating {asg.terminating}</li>
        </ul>
      </div>

      <label className="block">
        <span className="text-[10px] tracking-[0.18em] text-muted uppercase">report for</span>
        <select
          value={selected ?? ''}
          onChange={(e) => onSelect(e.target.value || null)}
          className="mt-1.5 w-full cursor-pointer border border-line bg-bg px-2 py-2 text-xs text-ink outline-none focus:border-accent/70"
        >
          <option value="">average · all servers</option>
          {instances.map((i) => (
            <option key={i.id} value={i.id}>
              {i.id} · {i.lifecycle.toLowerCase()}
              {i.cpu !== null ? ` · ${i.cpu.toFixed(1)}%` : ''}
            </option>
          ))}
        </select>
      </label>

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
