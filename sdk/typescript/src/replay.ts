import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname } from "node:path";
import { OrchidControlClient } from "./client.js";
import { session } from "./context.js";

function recordMode(): boolean {
  return ["1", "true", "yes"].includes(
    (process.env.ORCHID_RECORD ?? "").toLowerCase(),
  );
}

async function fixtureSessionId(path: string): Promise<string | undefined> {
  if (!existsSync(path)) return undefined;
  try {
    const data = JSON.parse(await readFile(path, "utf-8"));
    return data?.session?.id ?? undefined;
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn` with capture/replay backed by a JSON fixture file. Framework
 * agnostic — works as a plain wrapper in vitest, jest, or node:test.
 *
 * - If `ORCHID_RECORD=1`: runs `fn` in capture mode and exports the session's
 *   HTTP traffic to the fixture path afterwards.
 * - Otherwise: imports the fixture into the proxy and runs `fn` in replay
 *   mode, serving mocked responses with no external network calls.
 *
 * ```ts
 * test("user greeting", () =>
 *   withReplay("tests/fixtures/test_user_greeting.json", async () => {
 *     const response = await client.chat.completions.create({ ... });
 *     expect(response.choices[0].message.content).toMatch(/hello/i);
 *   }));
 * ```
 *
 * @param fixturePath Local JSON file path where traffic is saved/replayed.
 * @param fn The function to run under the fixture's session.
 * @param options.sessionId Session ID override; defaults to the fixture's
 *   recorded session ID, then the fixture file's base name.
 */
export async function withReplay<T>(
  fixturePath: string,
  fn: () => Promise<T>,
  options: { sessionId?: string } = {},
): Promise<T> {
  const client = new OrchidControlClient();
  const sessionId =
    options.sessionId ??
    (await fixtureSessionId(fixturePath)) ??
    basename(fixturePath, extname(fixturePath));

  if (recordMode()) {
    const result = await session(sessionId, "capture", fn);
    const flushSleep = Number(process.env.ORCHID_FLUSH_SLEEP ?? "0.2");
    if (flushSleep > 0) await sleep(flushSleep * 1000);
    await client.exportFixture(sessionId, fixturePath);
    return result;
  }

  if (!existsSync(fixturePath)) {
    throw new Error(`Fixture file not found: ${fixturePath}`);
  }
  await client.importFixture(fixturePath);
  return session(sessionId, "replay", fn);
}
