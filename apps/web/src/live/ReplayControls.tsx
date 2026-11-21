import type { LiveHook, Speed } from "./useLive.js";
import { clock, secs } from "./format.js";

/** Play/pause, speed and a scrubber for replaying a finished run. */
export function ReplayControls({ live }: { live: LiveHook }) {
  return (
    <div className="live-replay">
      <button type="button" className="btn sm" onClick={() => live.setPaused(!live.paused)}>
        {live.paused ? "Play" : "Pause"}
      </button>
      <span className="live-speeds" role="group" aria-label="Speed">
        {([1, 4, 16] as Speed[]).map((s) => (
          <button key={s} type="button" className={live.speed === s ? "on" : ""} aria-pressed={live.speed === s} onClick={() => live.setSpeed(s)}>
            {s}×
          </button>
        ))}
      </span>
      <input
        type="range"
        min={0}
        max={Math.max(1, live.duration)}
        step={100}
        value={live.position}
        onChange={(e) => live.seek(Number(e.target.value))}
        aria-label="Replay position"
      />
      <span className="muted">
        {clock(live.position)} / {clock(live.duration)}
      </span>
      {live.waited && (
        <span className="live-wait">
          Waited {secs(live.waited.realMs)} for {live.waited.what}
        </span>
      )}
    </div>
  );
}
