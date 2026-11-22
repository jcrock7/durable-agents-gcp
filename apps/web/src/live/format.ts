/** "0.4 sec", "35 sec", "2 min 05 sec", "3 hr 12 min": the words the rest of the portal uses. */
export function secs(ms: number): string {
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)} sec`;
  if (s < 60) return `${Math.round(s)} sec`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} sec`;
  return `${Math.floor(s / 3600)} hr ${Math.round((s % 3600) / 60)} min`;
}

/** "00:41" (or "1:02:05") from the run start. */
export function clock(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
  const s = String(t % 60).padStart(2, "0");
  return h ? `${h}:${m}:${s}` : `${m}:${s}`;
}

/** Offset of an event from the run start, "00:22.0". */
export function offset(iso: string, startIso: string): string {
  const ms = Date.parse(iso) - Date.parse(startIso);
  return `${clock(ms)}.${Math.floor((Math.max(0, ms) % 1000) / 100)}`;
}
