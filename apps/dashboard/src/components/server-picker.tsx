'use client';

import { useEffect, useRef, useState } from 'react';
import type { Ec2Instance } from '@/lib/types';

interface ServerPickerProps {
  instances: Ec2Instance[];
  /** null = average of all servers */
  selected: string | null;
  canPick: boolean;
  onSelect: (id: string | null) => void;
}

const cpuText = (cpu: number | null) => (cpu === null ? '—' : `${cpu.toFixed(1)}%`);

/** Which report the dashboard shows: the group average or one server. Always on screen. */
export function ServerPicker({ instances, selected, canPick, onSelect }: ServerPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const servers = instances.filter((i) => i.lifecycle === 'InService');

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (id: string | null) => {
    onSelect(id);
    setOpen(false);
  };

  const option = (id: string | null, main: React.ReactNode, side: string) => {
    const active = id === selected;
    return (
      <li key={id ?? 'average'}>
        <button
          type="button"
          role="option"
          aria-selected={active}
          onClick={() => pick(id)}
          className={`flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left ${
            active ? 'bg-cyan/15 text-cyan' : 'text-ink-2 hover:bg-cyan/10 hover:text-ink'
          }`}
        >
          <span>
            <span aria-hidden className={active ? '' : 'invisible'}>
              ▸{' '}
            </span>
            {main}
          </span>
          <span className="text-muted tabular-nums">{side}</span>
        </button>
      </li>
    );
  };

  // One server: its report is the average, nothing to pick, so plain text.
  if (!canPick) {
    return (
      <span title="Only one server is running: its report is the average">
        <span className="text-ink">average</span>
        <span className="text-muted"> · {servers.length} server{servers.length === 1 ? '' : 's'}</span>
      </span>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Pick which server to show"
        className="flex items-center gap-2 px-2.5 py-1 text-cyan transition-colors hover:bg-cyan/10"
      >
        {selected ? (
          <>
            <span className="text-muted">one server:</span>
            <span className="text-ink">{selected}</span>
          </>
        ) : (
          <>
            <span className="text-ink">average</span>
            <span className="text-muted">
              · {servers.length} server{servers.length === 1 ? '' : 's'}
            </span>
          </>
        )}
        <span aria-hidden className={`text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>

      {open && (
        <ul
          role="listbox"
          className="animate-slide-in absolute top-full left-0 z-30 mt-1 min-w-full border whitespace-nowrap border-cyan/40 bg-panel py-1 shadow-[0_8px_30px_rgba(0,0,0,0.6)]"
        >
          {option(null, <>average · all servers</>, `${servers.length} in service`)}
          <li aria-hidden className="mx-3 my-1 border-t border-line" />
          {servers.map((s) => option(s.id, <span className="text-ink">{s.id}</span>, `${s.az} · cpu ${cpuText(s.cpu)}`))}
        </ul>
      )}
    </div>
  );
}
