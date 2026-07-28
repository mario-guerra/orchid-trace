import http from "http";
import https from "https";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  injectHeaders,
  orchidFetch,
  purgeOrchidHeaders,
  rewriteUrl,
  shouldIntercept,
  init,
  uninstall,
} from "../src/core.js";
import { session } from "../src/context.js";

const ENV_KEYS = [
  "ORCHID_PROXY_URL",
  "ORCHID_API_KEY",
  "ORCHID_QUERY_URL",
  "ORCHID_SESSION_ID",
  "ORCHID_MODE",
  "ORCHID_CAPTURE_DOMAINS",
  "ORCHID_IGNORE_DOMAINS",
  "OPENAI_BASE_URL",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
];

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  uninstall();
  vi.restoreAllMocks();
});

describe("shouldIntercept", () => {
  it("intercepts core LLM providers", () => {
    expect(shouldIntercept(new URL("https://api.openai.com/v1/chat/completions"))).toBe(true);
    expect(shouldIntercept(new URL("https://api.anthropic.com/v1/messages"))).toBe(true);
    expect(shouldIntercept(new URL("https://generativelanguage.googleapis.com/v1beta/x"))).toBe(true);
    expect(shouldIntercept(new URL("https://us-central1-aiplatform.googleapis.com/v1/p"))).toBe(true);
  });

  it("never intercepts localhost", () => {
    process.env.ORCHID_CAPTURE_DOMAINS = "*";
    expect(shouldIntercept(new URL("http://localhost:8080/api"))).toBe(false);
    expect(shouldIntercept(new URL("http://127.0.0.1:4321/health"))).toBe(false);
  });

  it("does not intercept arbitrary domains by default", () => {
    expect(shouldIntercept(new URL("https://example.com/api"))).toBe(false);
  });

  it("respects ORCHID_CAPTURE_DOMAINS wildcard and list", () => {
    process.env.ORCHID_CAPTURE_DOMAINS = "*";
    expect(shouldIntercept(new URL("https://example.com/api"))).toBe(true);

    process.env.ORCHID_CAPTURE_DOMAINS = "serpapi.com, weather.gov";
    expect(shouldIntercept(new URL("https://serpapi.com/search"))).toBe(true);
    expect(shouldIntercept(new URL("https://other.com/x"))).toBe(false);
  });

  it("respects ORCHID_IGNORE_DOMAINS over capture rules", () => {
    process.env.ORCHID_CAPTURE_DOMAINS = "*";
    process.env.ORCHID_IGNORE_DOMAINS = "internal.corp";
    expect(shouldIntercept(new URL("https://internal.corp/api"))).toBe(false);
  });
});

describe("rewriteUrl", () => {
  it("rewrites core provider URLs without doubling /v1", () => {
    const out = rewriteUrl(new URL("https://api.openai.com/v1/chat/completions"));
    expect(out.toString()).toBe("http://127.0.0.1:4320/v1/chat/completions");
  });

  it("keeps paths sharing the /v1 prefix as-is (parity with Python/Rust SDKs)", () => {
    // Python and Rust SDKs use a plain prefix check, so /v1beta is treated as
    // already containing the proxy base path. Mirror that behavior exactly.
    const out = rewriteUrl(new URL("https://generativelanguage.googleapis.com/v1beta/models"));
    expect(out.toString()).toBe("http://127.0.0.1:4320/v1beta/models");
  });

  it("preserves path for non-core domains", () => {
    process.env.ORCHID_CAPTURE_DOMAINS = "serpapi.com";
    const out = rewriteUrl(new URL("https://serpapi.com/search?q=test"));
    expect(out.toString()).toBe("http://127.0.0.1:4320/search?q=test");
  });

  it("honors a custom ORCHID_PROXY_URL", () => {
    process.env.ORCHID_PROXY_URL = "http://proxy.internal:9999/v1";
    const out = rewriteUrl(new URL("https://api.openai.com/v1/chat/completions"));
    expect(out.toString()).toBe("http://proxy.internal:9999/v1/chat/completions");
  });
});

describe("injectHeaders", () => {
  it("injects API key, session, mode, and target URL for proxy-bound requests", () => {
    process.env.ORCHID_API_KEY = "secret-key";
    const headers = new Headers();
    session("sess-1", "capture", () => {
      injectHeaders(
        headers,
        new URL("http://127.0.0.1:4320/v1/chat/completions"),
        new URL("https://api.openai.com/v1/chat/completions"),
      );
    });
    expect(headers.get("X-Orchid-Api-Key")).toBe("secret-key");
    expect(headers.get("X-Orchid-Session-Id")).toBe("sess-1");
    expect(headers.get("X-Orchid-Mode")).toBe("capture");
    expect(headers.get("X-Orchid-Target-Url")).toBe("https://api.openai.com");
  });

  it("defaults mode to capture when only a session id is set via env", () => {
    const headers = new Headers();
    process.env.ORCHID_SESSION_ID = "env-sess";
    injectHeaders(headers, new URL("http://127.0.0.1:4320/v1/x"));
    expect(headers.get("X-Orchid-Session-Id")).toBe("env-sess");
    expect(headers.get("X-Orchid-Mode")).toBe("capture");
  });

  it("does not inject headers for non-proxy destinations", () => {
    const headers = new Headers();
    session("sess-3", "capture", () => {
      injectHeaders(headers, new URL("https://api.openai.com/v1/x"));
    });
    expect(headers.get("X-Orchid-Session-Id")).toBeNull();
  });
});

describe("purgeOrchidHeaders", () => {
  it("removes all x-orchid-* headers case-insensitively", () => {
    const headers = new Headers({
      "X-Orchid-Api-Key": "k",
      "x-orchid-session-id": "s",
      Authorization: "Bearer real-key",
    });
    purgeOrchidHeaders(headers);
    expect(headers.get("x-orchid-api-key")).toBeNull();
    expect(headers.get("x-orchid-session-id")).toBeNull();
    expect(headers.get("Authorization")).toBe("Bearer real-key");
  });
});

type FetchInput = Request | string | URL;

describe("orchidFetch", () => {
  it("routes intercepted requests to the proxy with headers", async () => {
    const mock = vi.fn(async (_input: FetchInput) => new Response("ok"));
    vi.stubGlobal("fetch", mock);

    await session("test-session", "capture", () =>
      orchidFetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer sk-real" },
        body: JSON.stringify({ model: "gpt-4o" }),
      }),
    );

    expect(mock).toHaveBeenCalledTimes(1);
    const req = mock.mock.calls[0][0] as Request;
    expect(req.url).toBe("http://127.0.0.1:4320/v1/chat/completions");
    expect(req.headers.get("X-Orchid-Session-Id")).toBe("test-session");
    expect(req.headers.get("X-Orchid-Mode")).toBe("capture");
    expect(req.headers.get("X-Orchid-Target-Url")).toBe("https://api.openai.com");
    expect(req.headers.get("Authorization")).toBe("Bearer sk-real");
  });

  it("passes through non-intercepted requests untouched", async () => {
    const mock = vi.fn(async (_input: FetchInput) => new Response("ok"));
    vi.stubGlobal("fetch", mock);

    await orchidFetch("https://example.com/data");

    const req = mock.mock.calls[0][0] as Request;
    expect(req.url).toBe("https://example.com/data");
    expect(req.headers.get("X-Orchid-Mode")).toBeNull();
  });

  it("falls back to direct routing with purged headers on connection failure", async () => {
    const connError = new TypeError("fetch failed");
    (connError as TypeError & { cause: { code: string } }).cause = {
      code: "ECONNREFUSED",
    };
    const mock = vi
      .fn()
      .mockRejectedValueOnce(connError)
      .mockResolvedValueOnce(new Response("direct"));
    vi.stubGlobal("fetch", mock);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const resp = await session("s", "capture", () =>
      orchidFetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer sk-real" },
        body: "{}",
      }),
    );

    expect(await resp.text()).toBe("direct");
    expect(mock).toHaveBeenCalledTimes(2);
    const fallbackReq = mock.mock.calls[1][0] as Request;
    expect(fallbackReq.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(fallbackReq.headers.get("X-Orchid-Session-Id")).toBeNull();
    expect(fallbackReq.headers.get("X-Orchid-Mode")).toBeNull();
    expect(fallbackReq.headers.get("Authorization")).toBe("Bearer sk-real");
    expect(warn).toHaveBeenCalled();
  });

  it("rethrows non-connection errors without fallback", async () => {
    const mock = vi.fn().mockRejectedValue(new Error("boom"));
    vi.stubGlobal("fetch", mock);

    await expect(
      orchidFetch("https://api.openai.com/v1/chat/completions"),
    ).rejects.toThrow("boom");
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe("init", () => {
  it("patches global fetch and sets OPENAI_BASE_URL (health check bypassed)", async () => {
    const before = globalThis.fetch;
    await init({ bypassHealthCheck: true });
    expect(globalThis.fetch).not.toBe(before);
    expect(process.env.OPENAI_BASE_URL).toBe("http://127.0.0.1:4320/v1");
    uninstall();
    expect(globalThis.fetch).toBe(before);
  });

  it("throws on malformed ORCHID_PROXY_URL", async () => {
    process.env.ORCHID_PROXY_URL = "not a url";
    await expect(init({ bypassHealthCheck: true })).rejects.toThrow(
      /Malformed ORCHID_PROXY_URL/,
    );
  });

  it("intercepts http.request to core providers and redirects to proxy", async () => {
    const mockReq = {} as any;
    const mockRequest = vi.spyOn(http, "request").mockReturnValue(mockReq);

    await init({ bypassHealthCheck: true });

    http.request({
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    const [options] = mockRequest.mock.calls[0] as any;
    expect(options.protocol).toBe("http:");
    expect(options.hostname).toBe("127.0.0.1");
    expect(options.port).toBe("4320");
    expect(options.path).toBe("/v1/chat/completions");
    expect(options.headers["x-orchid-target-url"]).toBe("http://api.openai.com");
  });

  it("redirects https.request to plain http proxy", async () => {
    const mockReq = {} as any;
    const mockHttpRequest = vi.spyOn(http, "request").mockReturnValue(mockReq);
    const mockHttpsRequest = vi.spyOn(https, "request").mockReturnValue(mockReq);

    await init({ bypassHealthCheck: true });

    https.request({
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    // Should call the original http.request (not https.request) because proxy is plain HTTP
    expect(mockHttpRequest).toHaveBeenCalledTimes(1);
    expect(mockHttpsRequest).not.toHaveBeenCalled();

    const [options] = mockHttpRequest.mock.calls[0] as any;
    expect(options.protocol).toBe("http:");
    expect(options.hostname).toBe("127.0.0.1");
    expect(options.port).toBe("4320");
    expect(options.path).toBe("/v1/chat/completions");
    expect(options.headers["x-orchid-target-url"]).toBe("https://api.openai.com");
  });

  it("does not intercept non-core provider http.request by default", async () => {
    const mockReq = {} as any;
    const mockRequest = vi.spyOn(http, "request").mockReturnValue(mockReq);

    await init({ bypassHealthCheck: true });

    http.request({
      hostname: "example.com",
      path: "/api/data",
      method: "GET",
    });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    const [options] = mockRequest.mock.calls[0] as any;
    expect(options.hostname).toBe("example.com");
    expect(options.protocol).toBeUndefined(); // Node defaults to http internally
    expect(options.path).toBe("/api/data");
    expect(options.headers?.["x-orchid-target-url"]).toBeUndefined();
  });

  it("uninstall() deactivates http.request and https.request interception", async () => {
    const mockHttpRequest = vi.spyOn(http, "request").mockReturnValue({} as any);

    await init({ bypassHealthCheck: true });
    
    uninstall();

    http.request({
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
    });

    expect(mockHttpRequest).toHaveBeenCalledTimes(1);
    const [options] = mockHttpRequest.mock.calls[0] as any;
    expect(options.hostname).toBe("api.openai.com");
    expect(options.headers?.["x-orchid-target-url"]).toBeUndefined();
  });

  it("warns if pricing is empty on initialization", async () => {
    const mockFetch = vi.fn(async (input: FetchInput) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      if (url.endsWith("/pricing")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", mockFetch);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await init({ bypassHealthCheck: false });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("No pricing schema is configured on the Orchid proxy")
    );
  });

  it("does not warn if pricing contains entries", async () => {
    const mockFetch = vi.fn(async (input: FetchInput) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      if (url.endsWith("/pricing")) {
        return new Response(
          JSON.stringify({ openai: { "gpt-4o": { prompt: 5, completion: 15 } } }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", mockFetch);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await init({ bypassHealthCheck: false });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("patches google-auth-library in replay mode", async () => {
    const mockOAuth2Client = class {
      credentials: any = {};
      async getRequestHeaders() { return {}; }
      async getAccessToken() { return {}; }
    };
    const mockGoogleAuth = class {
      async getClient() { return {}; }
      async getCredentials() { return {}; }
      async getProjectId() { return ""; }
    };

    vi.doMock("google-auth-library", () => ({
      GoogleAuth: mockGoogleAuth,
      OAuth2Client: mockOAuth2Client,
    }));

    process.env.ORCHID_MODE = "replay";
    await init({ bypassHealthCheck: true });

    // Verify prototype was patched
    const auth = new mockGoogleAuth() as any;
    const client = await auth.getClient();
    expect(client).toBeInstanceOf(mockOAuth2Client);
    expect(await client.getRequestHeaders()).toEqual({
      Authorization: "Bearer orchid-replay-dummy-token",
    });
    expect(await client.getAccessToken()).toEqual({
      token: "orchid-replay-dummy-token",
    });
    expect(await auth.getCredentials()).toEqual({
      client_email: "orchid-replay-dummy@project.iam.gserviceaccount.com",
      private_key: "dummy-key",
    });
    expect(await auth.getProjectId()).toBe("orchid-replay-project");

    // Clean up
    uninstall();
    
    // Verify restored
    const restoredAuth = new mockGoogleAuth() as any;
    expect(await restoredAuth.getClient()).toEqual({});
    expect(await restoredAuth.getCredentials()).toEqual({});
    expect(await restoredAuth.getProjectId()).toBe("");
  });
});
