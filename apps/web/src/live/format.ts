/** "0.4s", "35s", "2m 05s", "3h 12m". */
export function secs(ms: number): string {
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
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
