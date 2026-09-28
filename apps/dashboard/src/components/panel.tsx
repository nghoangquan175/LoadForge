import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  /** small source hint, e.g. the CloudWatch metric name */
  tag?: string;
  right?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

export function Panel({ title, tag, right, className = '', bodyClassName = '', children }: PanelProps) {
  return (
    <section className={`brackets flex min-w-0 flex-col border border-line bg-panel/90 backdrop-blur-[2px] ${className}`}>
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <h2 className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-2">
          <span className="text-accent">{'// '}</span>
          {title}
        </h2>
        <div className="flex shrink-0 items-center gap-3">
          {tag && <span className="hidden text-[10px] text-muted sm:inline">{tag}</span>}
          {right}
        </div>
      </header>
      <div className={`min-h-0 flex-1 p-4 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
