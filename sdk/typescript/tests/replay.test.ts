import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withReplay } from "../src/replay.js";
import { currentMode, currentSessionId } from "../src/context.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "orchid-sdk-test-"));
  delete process.env.ORCHID_RECORD;
  delete process.env.ORCHID_FLUSH_SLEEP;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const FIXTURE = { session: { id: "fixture-sess" }, exchanges: [] };

describe("withReplay (replay mode)", () => {
  it("imports the fixture and runs fn in replay mode with the fixture's session id", async () => {
    const path = join(dir, "fixture.json");
    await writeFile(path, JSON.stringify(FIXTURE));

    const mock = vi.fn(async (input: Request | string | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/v1/sessions/import")) {
        return new Response(null, { status: 201 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", mock);

    let seen: { sessionId?: string; mode?: string } = {};
    const result = await withReplay(path, async () => {
      seen = { sessionId: currentSessionId(), mode: currentMode() };
      return 42;
    });

    expect(result).toBe(42);
    expect(seen.sessionId).toBe("fixture-sess");
    expect(seen.mode).toBe("replay");
    const importCall = mock.mock.calls.find((c) =>
      String(c[0] instanceof Request ? c[0].url : c[0]).endsWith("/v1/sessions/import"),
    );
    expect(importCall).toBeDefined();
  });

  it("throws when the fixture does not exist", async () => {
    await expect(
      withReplay(join(dir, "missing.json"), async () => 1),
    ).rejects.toThrow(/Fixture file not found/);
  });
});

describe("withReplay (record mode)", () => {
  it("runs fn in capture mode and exports the session to the fixture path", async () => {
    process.env.ORCHID_RECORD = "1";
    process.env.ORCHID_FLUSH_SLEEP = "0";
    const path = join(dir, "out.json");

    const mock = vi.fn(async (input: Request | string | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/export")) {
        return new Response(JSON.stringify(FIXTURE), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", mock);

    let seen: { sessionId?: string; mode?: string } = {};
    await withReplay(path, async () => {
      seen = { sessionId: currentSessionId(), mode: currentMode() };
    });

    // No pre-existing fixture: session id defaults to file base name
    expect(seen.sessionId).toBe("out");
    expect(seen.mode).toBe("capture");
    const written = JSON.parse(await readFile(path, "utf-8"));
    expect(written.session.id).toBe("fixture-sess");
  });

  it("honors an explicit sessionId override", async () => {
    process.env.ORCHID_RECORD = "1";
    process.env.ORCHID_FLUSH_SLEEP = "0";
    const path = join(dir, "out.json");

    const mock = vi.fn(async () =>
      new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );
    vi.stubGlobal("fetch", mock);

    let seenId: string | undefined;
    await withReplay(
      path,
      async () => {
        seenId = currentSessionId();
      },
      { sessionId: "my-custom-session" },
    );
    expect(seenId).toBe("my-custom-session");
  });
});
