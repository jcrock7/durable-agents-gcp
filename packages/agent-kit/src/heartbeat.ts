import { Context } from "@temporalio/activity";

/**
 * Run a long call (such as a model request) inside an activity while heartbeating to Temporal.
 *
 * Heartbeats let Temporal notice a dead worker within the activity's heartbeatTimeout (20s for
 * model calls) instead of waiting out the full startToCloseTimeout, so a crashed call is retried
 * on another worker quickly. The abort signal fires if the workflow cancels the activity, so pass
 * it to the request.
 *
 * Call `progress(details)` to attach details to the heartbeats: one is sent at once, and every
 * later one carries the latest details. The portal reads them from the pending activity, and a
 * retry of the activity can resume from them (`Context.current().info.heartbeatDetails`).
 */
export async function withHeartbeat<T>(
  call: (abortSignal: AbortSignal, progress: (details: unknown) => void) => Promise<T>,
  intervalMs = 5_000,
): Promise<T> {
  const context = Context.current();
  let latest: unknown;
  const beat = () => (latest === undefined ? context.heartbeat() : context.heartbeat(latest));
  const timer = setInterval(beat, intervalMs);
  const progress = (details: unknown) => {
    latest = details;
    beat();
  };
  try {
    return await call(context.cancellationSignal, progress);
  } finally {
    clearInterval(timer);
  }
}
