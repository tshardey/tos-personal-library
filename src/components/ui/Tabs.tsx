import { useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  panel,
}: {
  label: string;
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  panel: (id: T) => ReactNode;
}) {
  const base = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = (id: string) => `${base}-panel-${id}`;

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    const id = tabs[next].id;
    tabRefs.current[id]?.focus();
    onChange(id);
  }

  return (
    <div>
      <div role="tablist" aria-label={label} className="flex gap-1 border-b border-line-strong">
        {tabs.map((t, i) => {
          const selected = t.id === value;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={tabId(t.id)}
              aria-selected={selected}
              aria-controls={panelId(t.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`-mb-px min-h-11 sm:min-h-9 border-b-2 px-3 ${selected ? "border-accent text-fg-strong" : "border-transparent text-muted hover:text-fg"}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={panelId(value)} aria-labelledby={tabId(value)} tabIndex={0}>
        {panel(value)}
      </div>
    </div>
  );
}
