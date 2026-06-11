import { AsyncLocalStorage } from "node:async_hooks";

export type OrchidMode = "capture" | "replay" | "passthrough" | "log";

export interface OrchidContext {
  sessionId: string;
  mode: OrchidMode;
}

const storage = new AsyncLocalStorage<OrchidContext>();

/** Returns the active session ID, falling back to ORCHID_SESSION_ID. */
export function currentSessionId(): string | undefined {
  return storage.getStore()?.sessionId ?? process.env.ORCHID_SESSION_ID ?? undefined;
}

/** Returns the active mode, falling back to ORCHID_MODE. */
export function currentMode(): string | undefined {
  return storage.getStore()?.mode ?? process.env.ORCHID_MODE ?? undefined;
}

/**
 * Runs `fn` with the given Orchid session context. All requests dispatched
 * (transitively) inside `fn` are grouped under `sessionId` with the given mode.
 *
 * ```ts
 * await session("user-onboarding-flow", "capture", async () => {
 *   await client.chat.completions.create({ ... });
 * });
 * ```
 */
export function session<T>(
  sessionId: string,
  mode: OrchidMode,
  fn: () => T,
): T {
  return storage.run({ sessionId, mode }, fn);
}
