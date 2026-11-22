import { useRef, type KeyboardEvent } from "react";

/**
 * Props for an accessible tab set (WAI-ARIA tabs, automatic activation): one tab stop, arrow keys and
 * Home/End move between tabs, and a single tab panel labelled by the selected tab.
 */
export function useTabs<T extends string>(base: string, ids: readonly T[], value: T, onChange: (id: T) => void) {
  const refs = useRef(new Map<T, HTMLButtonElement | null>());
  const tabId = (id: T) => `${base}-tab-${id}`;
  const panelId = `${base}-panel`;
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const i = ids.indexOf(value);
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? ids[(i + 1) % ids.length] : e.key === "ArrowLeft" || e.key === "ArrowUp" ? ids[(i - 1 + ids.length) % ids.length] : e.key === "Home" ? ids[0] : e.key === "End" ? ids.at(-1) : undefined;
    if (next === undefined) return;
    e.preventDefault();
    onChange(next);
    refs.current.get(next)?.focus();
  };
  return {
    list: { role: "tablist" as const, onKeyDown },
    tab: (id: T) => ({
      role: "tab" as const,
      id: tabId(id),
      "aria-selected": id === value,
      "aria-controls": panelId,
      tabIndex: id === value ? 0 : -1,
      ref: (el: HTMLButtonElement | null) => {
        refs.current.set(id, el);
      },
      onClick: () => onChange(id),
    }),
    panel: { role: "tabpanel" as const, id: panelId, "aria-labelledby": tabId(value), tabIndex: 0 },
  };
}
