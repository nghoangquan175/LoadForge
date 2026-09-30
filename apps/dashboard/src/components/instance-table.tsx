import { fmtDuration } from '@/lib/format';
import type { Ec2Instance, InstanceLifecycle } from '@/lib/types';

const LIFECYCLE: Record<InstanceLifecycle, { label: string; icon: string; className: string }> = {
  Pending: { label: 'PENDING', icon: '◌', className: 'text-cyan' },
  InService: { label: 'IN_SERVICE', icon: '●', className: 'text-accent' },
  Terminating: { label: 'TERMINATING', icon: '✕', className: 'text-crit' },
  Terminated: { label: 'TERMINATED', icon: '✕', className: 'text-muted' },
  Standby: { label: 'STANDBY', icon: '◍', className: 'text-ink-2' },
};

function CpuMeter({ cpu }: { cpu: number | null }) {
  if (cpu === null) return <span className="text-muted">--</span>;
  const tone = cpu >= 90 ? 'bg-crit' : cpu >= 70 ? 'bg-warn' : 'bg-accent';
  const track = cpu >= 90 ? 'bg-crit/15' : cpu >= 70 ? 'bg-warn/15' : 'bg-accent/15';
  return (
    <div className="flex items-center gap-2">
      <div className={`h-1.5 w-20 overflow-hidden rounded-full ${track}`}>
        <div className={`h-full rounded-full transition-[width] duration-700 ${tone}`} style={{ width: `${Math.min(cpu, 100)}%` }} />
      </div>
      <span className="w-12 text-right text-ink tabular-nums">{cpu.toFixed(1)}%</span>
    </div>
  );
}

interface InstanceTableProps {
  instances: Ec2Instance[];
  now: number;
  selected: string | null;
  /** click a row to see that server's report, click again for the average */
  onSelect: (id: string | null) => void;
}

export function InstanceTable({ instances, now, selected, onSelect }: InstanceTableProps) {
  const rows = [...instances].sort((a, b) => a.launchedAt - b.launchedAt);

  if (!rows.length) {
    return <p className="text-xs text-muted">no instances registered in this group_</p>;
  }

  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[640px] text-left text-xs whitespace-nowrap">
        <thead>
          <tr className="text-[10px] tracking-widest text-muted uppercase">
            <th className="pb-2 pl-2 font-normal">instance</th>
            <th className="pb-2 font-normal">zone</th>
            <th className="pb-2 font-normal">state</th>
            <th className="pb-2 font-normal">health</th>
            <th className="pb-2 font-normal">cpu</th>
            <th className="pb-2 text-right font-normal">uptime</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((inst) => {
            const lc = LIFECYCLE[inst.lifecycle];
            const isSelected = inst.id === selected;
            const toggle = () => onSelect(isSelected ? null : inst.id);
            return (
              <tr
                key={inst.id}
                onClick={toggle}
                aria-selected={isSelected}
                className={`animate-slide-in cursor-pointer border-t border-line/70 ${
                  isSelected ? 'bg-cyan/[0.07] shadow-[inset_2px_0_0_var(--color-cyan)]' : 'hover:bg-accent/[0.03]'
                }`}
              >
                <td className="py-2 pr-3 pl-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle();
                    }}
                    className={`text-left outline-none focus-visible:underline ${isSelected ? 'text-cyan' : 'text-ink'}`}
                  >
                    {inst.id}
                  </button>
                  <div className="text-[10px] text-muted">
                    {inst.type} · {inst.privateIp ?? '—'}
                  </div>
                </td>
                <td className="py-2 pr-3 text-ink-2">{inst.az}</td>
                <td className={`py-2 pr-3 ${lc.className}`}>
                  <span className={inst.lifecycle === 'Pending' ? 'animate-blink' : ''} aria-hidden>{lc.icon} </span>
                  {lc.label}
                </td>
                <td className={`py-2 pr-3 ${inst.health === 'Healthy' ? 'text-ink-2' : 'text-crit'}`}>
                  {inst.health === 'Healthy' ? '✔ healthy' : '⚠ unhealthy'}
                </td>
                <td className="py-2 pr-3"><CpuMeter cpu={inst.cpu} /></td>
                <td className="py-2 text-right text-ink-2 tabular-nums">{fmtDuration(now - inst.launchedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
