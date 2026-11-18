import { Context } from "@temporalio/activity";

/**
 * Run a long call (such as a model request) inside an activity while heartbeating to Temporal.
 *
 * Heartbeats let Temporal notice a dead worker within the activity's heartbeatTimeout (20s for
 * model calls) instead of waiting out the full startToCloseTimeout, so a crashed call is retried
 * on another worker quickly. The abort signal fires if the workflow cancels the activity, so pass
 * it to the request.
 */
export async function withHeartbeat<T>(call: (abortSignal: AbortSignal) => Promise<T>, intervalMs = 5_000): Promise<T> {
  const context = Context.current();
  const timer = setInterval(() => context.heartbeat(), intervalMs);
  try {
    return await call(context.cancellationSignal);
  } finally {
    clearInterval(timer);
  }
}
