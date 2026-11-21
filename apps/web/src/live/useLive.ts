// Live Run data: polls /api/cases/:id/live every second while the run is RUNNING (appending engine
// events after a cursor), or, for a finished run, loads it once and plays it back on a clock.
import { useEffect, useMemo, useRef, useState } from "react";
import { getJson, type LiveResponse } from "../api.js";
import type { LiveGraph } from "./graphs.js";
import { mergeLive, reduceLive, replayFrames, type LiveView, type ReplayFrame } from "./reduce.js";

export type Speed = 1 | 4 | 16;
export const POLL_MS = 1_000;

export interface LiveHook {
  mode: "loading" | "live" | "replay";
  view?: LiveView;
  /** Replay only. */
  speed: Speed;
  setSpeed: (s: Speed) => void;
  paused: boolean;
  setPaused: (p: boolean) => void;
  position: number;
  duration: number;
  seek: (ms: number) => void;
  waited?: ReplayFrame["waited"];
  error?: string;
}

export function useLive(workflowId: string, graph: LiveGraph | undefined): LiveHook {
  const [mode, setMode] = useState<LiveHook["mode"]>("loading");
  const [res, setRes] = useState<LiveResponse>();
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  const [frames, setFrames] = useState<ReplayFrame[]>([]);
  const [position, setPosition] = useState(0);
  const [speed, setSpeed] = useState<Speed>(4);
  const [paused, setPaused] = useState(false);
  const last = useRef<LiveResponse | undefined>(undefined);

  // Load, then poll while running.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cursor = 0;
    last.current = undefined;
    setMode("loading");
    setRes(undefined);
    const tick = async (first: boolean) => {
      try {
        const next = await getJson<LiveResponse>(`/api/cases/${workflowId}/live?after=${cursor}`);
        if (stop) return;
        const merged = mergeLive(last.current, next);
        last.current = merged;
        cursor = next.cursor;
        setError(undefined);
        if (first && next.status !== "RUNNING") {
          setFrames(replayFrames(merged));
          setPosition(0);
          setPaused(false);
          setMode("replay");
          setRes(merged);
          return;
        }
        if (first) setMode("live");
        setRes(merged);
        if (next.status === "RUNNING") timer = setTimeout(() => void tick(false), POLL_MS);
      } catch (e) {
        if (stop) return;
        setError(e instanceof Error ? e.message : String(e));
        timer = setTimeout(() => void tick(first), POLL_MS * 2);
      }
    };
    void tick(true);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [workflowId]);

  // Live clock for elapsed time and running-step durations.
  useEffect(() => {
    if (mode !== "live" || res?.status !== "RUNNING") return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [mode, res?.status]);

  // Replay clock.
  const duration = frames.at(-1)?.at ?? 0;
  useEffect(() => {
    if (mode !== "replay" || paused) return;
    let last = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const dt = (t - last) * speed;
      last = t;
      setPosition((p) => {
        const next = Math.min(duration, p + dt);
        if (next >= duration) setPaused(true);
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [mode, paused, speed, duration]);

  const frame = useMemo(() => {
    if (mode !== "replay" || frames.length === 0) return undefined;
    let i = 0;
    while (i + 1 < frames.length && frames[i + 1]!.at <= position) i++;
    return frames[i];
  }, [mode, frames, position]);

  const view = useMemo(() => {
    if (!graph) return undefined;
    if (mode === "replay" && frame) return reduceLive(graph, frame.res, frame.real);
    return res ? reduceLive(graph, res, now) : undefined;
  }, [graph, mode, frame, res, now]);

  const recentWait = frame?.waited && position - frame.at < 2_500 ? frame.waited : undefined;
  return {
    mode,
    view,
    speed,
    setSpeed,
    paused,
    setPaused: (p) => {
      if (!p && position >= duration) setPosition(0);
      setPaused(p);
    },
    position,
    duration,
    seek: (ms) => setPosition(Math.max(0, Math.min(duration, ms))),
    waited: recentWait,
    error,
  };
}
