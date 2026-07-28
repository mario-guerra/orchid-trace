import http from "http";
import https from "https";
import { currentMode, currentSessionId } from "./context.js";

const CORE_PROVIDERS = [
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "aiplatform.googleapis.com",
];

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

let patched = false;
let httpPatched = false;
let offlineFallback = false;
let originalFetch: typeof globalThis.fetch | undefined;
let originalHttpRequest: typeof http.request | undefined;
let originalHttpsRequest: typeof https.request | undefined;

let originalGetClient: any;
let originalGetCredentials: any;
let originalGetProjectId: any;
let googleAuthLibraryPatched = false;
let patchedGauth: any;

/** Tracks env vars set by orchid-sdk so uninstall() only removes what it owned. */
const ownedEnvVars = new Set<string>();

function proxyUrl(): string {
  return process.env.ORCHID_PROXY_URL ?? "http://127.0.0.1:4320/v1";
}

/** Sets an env var only if not already defined, and records ownership. */
function setEnvIfAbsent(key: string, value: string): void {
  if (!process.env[key]) {
    process.env[key] = value;
    ownedEnvVars.add(key);
  }
}

function normalizeArgs(
  defaultProtocol: string,
  arg1: any,
  arg2: any,
  arg3: any
): { options: any; callback: any; originalUrl: URL } {
  let options: any = {};
  let callback: any;
  let urlStr = "";

  if (typeof arg1 === "string" || arg1 instanceof URL) {
    urlStr = arg1.toString();
    if (typeof arg2 === "object") {
      options = { ...arg2 };
      callback = arg3;
    } else {
      callback = arg2;
    }
  } else if (typeof arg1 === "object") {
    options = { ...arg1 };
    callback = arg2;
  }

  options.headers = options.headers ? { ...options.headers } : {};

  // Reconstruct target URL from options if urlStr is empty
  if (!urlStr) {
    const protocol = options.protocol || defaultProtocol;
    const host = options.host || options.hostname || "localhost";
    const hostWithPort = host.includes(":") ? host : `${host}${options.port ? `:${options.port}` : ""}`;
    const path = options.path || "/";
    urlStr = `${protocol}//${hostWithPort}${path}`;
  }

  const originalUrl = new URL(urlStr);
  return { options, callback, originalUrl };
}

function patchHttp(): void {
  if (httpPatched) return;
  originalHttpRequest = http.request;
  originalHttpsRequest = https.request;

  http.request = function (this: any, arg1: any, arg2: any, arg3: any): http.ClientRequest {
    if (!httpPatched) {
      return originalHttpRequest!.apply(this, arguments as any);
    }
    const { options, callback, originalUrl } = normalizeArgs("http:", arg1, arg2, arg3);
    
    if (shouldIntercept(originalUrl)) {
      const rewrittenUrl = rewriteUrl(originalUrl);
      options.protocol = rewrittenUrl.protocol;
      options.hostname = rewrittenUrl.hostname;
      options.host = rewrittenUrl.host;
      options.port = rewrittenUrl.port;
      options.path = rewrittenUrl.pathname + rewrittenUrl.search;
      
      delete options.agent;
      delete options.createConnection;
      if (options.headers) {
        delete options.headers["host"];
        delete options.headers["Host"];
      }

      const headersObj = new Headers(options.headers);
      injectHeaders(headersObj, rewrittenUrl, originalUrl);
      const newHeaders: Record<string, string> = {};
      headersObj.forEach((val, key) => {
        newHeaders[key] = val;
      });
      options.headers = newHeaders;
      
      return originalHttpRequest!.call(this, options, callback);
    }
    
    return originalHttpRequest!.apply(this, arguments as any);
  } as any;

  https.request = function (this: any, arg1: any, arg2: any, arg3: any): http.ClientRequest {
    if (!httpPatched) {
      return originalHttpsRequest!.apply(this, arguments as any);
    }
    const { options, callback, originalUrl } = normalizeArgs("https:", arg1, arg2, arg3);
    
    if (shouldIntercept(originalUrl)) {
      const rewrittenUrl = rewriteUrl(originalUrl);
      options.protocol = rewrittenUrl.protocol;
      options.hostname = rewrittenUrl.hostname;
      options.host = rewrittenUrl.host;
      options.port = rewrittenUrl.port;
      options.path = rewrittenUrl.pathname + rewrittenUrl.search;
      
      delete options.agent;
      delete options.createConnection;
      if (options.headers) {
        delete options.headers["host"];
        delete options.headers["Host"];
      }

      const headersObj = new Headers(options.headers);
      injectHeaders(headersObj, rewrittenUrl, originalUrl);
      const newHeaders: Record<string, string> = {};
      headersObj.forEach((val, key) => {
        newHeaders[key] = val;
      });
      options.headers = newHeaders;
      
      // Redirect HTTPS request to HTTP proxy
      return originalHttpRequest!.call(this, options, callback);
    }
    
    return originalHttpsRequest!.apply(this, arguments as any);
  } as any;

  httpPatched = true;
}

function unpatchHttp(): void {
  // Set the deactivation flag to false. The monkeypatched functions
  // remain in place to avoid breaking wrapping order, but behave
  // as passive passthroughs.
  httpPatched = false;
}

function envList(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isCoreProvider(host: string): boolean {
  return CORE_PROVIDERS.some((c) => host.includes(c));
}

export function shouldIntercept(url: URL): boolean {
  if (offlineFallback) return false;

  const host = url.hostname;
  // Safe list: never proxy localhost/VPC loops
  if (LOCAL_HOSTS.some((h) => host === h)) return false;

  if (envList("ORCHID_IGNORE_DOMAINS").some((d) => host.includes(d))) {
    return false;
  }

  // In replay mode, intercept all non-ignored external hosts so the proxy can match them against the DB
  const mode = currentMode() || process.env.ORCHID_MODE;
  if (mode === "replay") return true;

  if (isCoreProvider(host)) return true;

  const capture = envList("ORCHID_CAPTURE_DOMAINS");
  if (capture.includes("*")) return true;
  if (capture.some((d) => host.includes(d))) return true;

  return false;
}

/**
 * Rewrites an upstream LLM request URL to route through the Orchid proxy.
 * e.g. https://api.openai.com/v1/chat/completions -> http://127.0.0.1:4320/v1/chat/completions
 */
export function rewriteUrl(originalUrl: URL): URL {
  const proxy = new URL(proxyUrl());
  const rewritten = new URL(originalUrl.toString());
  rewritten.protocol = proxy.protocol;
  rewritten.host = proxy.host;

  if (isCoreProvider(originalUrl.hostname)) {
    const proxyBasePath = proxy.pathname.replace(/\/+$/, "");
    if (proxyBasePath && !originalUrl.pathname.startsWith(proxyBasePath)) {
      rewritten.pathname = proxyBasePath + originalUrl.pathname;
    }
  }
  return rewritten;
}

/**
 * Injects Orchid control headers when the request targets the Orchid proxy.
 */
export function injectHeaders(
  headers: Headers,
  targetUrl: URL,
  originalUrl?: URL,
): void {
  const proxy = new URL(proxyUrl());
  if (targetUrl.host !== proxy.host) return;

  const apiKey = process.env.ORCHID_API_KEY;
  if (apiKey) headers.set("X-Orchid-Api-Key", apiKey);

  const sessionId = currentSessionId();
  let mode = currentMode();
  if (sessionId) {
    headers.set("X-Orchid-Session-Id", sessionId);
    if (!mode) mode = "capture";
  }
  if (mode) headers.set("X-Orchid-Mode", mode);

  if (originalUrl && originalUrl.host !== proxy.host) {
    headers.set(
      "X-Orchid-Target-Url",
      `${originalUrl.protocol}//${originalUrl.host}`,
    );
  }
}

/**
 * Case-insensitively purges all `x-orchid-*` headers to prevent internal
 * metadata leakage to upstream providers during fail-soft fallback.
 */
export function purgeOrchidHeaders(headers: Headers): void {
  const toDelete: string[] = [];
  headers.forEach((_value, key) => {
    if (key.toLowerCase().startsWith("x-orchid-")) toDelete.push(key);
  });
  for (const key of toDelete) headers.delete(key);
}

function isConnectionError(err: unknown): boolean {
  // Node's fetch (undici) throws TypeError("fetch failed") with a cause
  // carrying a syscall error code for connection-level failures.
  if (!(err instanceof Error)) return false;
  const cause = (err as Error & { cause?: { code?: string } }).cause;
  const code = cause?.code ?? (err as Error & { code?: string }).code;
  return (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EHOSTUNREACH" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_SOCKET"
  );
}

/**
 * An explicit fetch wrapper implementing Orchid interception. Use this
 * directly (e.g. pass it as a custom `fetch` to an LLM client) if you prefer
 * not to patch the global fetch.
 */
export const orchidFetch: typeof globalThis.fetch = async (input, init?) => {
  const baseFetch = originalFetch ?? globalThis.fetch;
  const request = new Request(input, init);
  const original = new URL(request.url);

  if (!shouldIntercept(original)) {
    // Still inject context headers if the app explicitly targets the proxy.
    const headers = new Headers(request.headers);
    injectHeaders(headers, original);
    return baseFetch(new Request(request, { headers }));
  }

  const rewritten = rewriteUrl(original);
  const headers = new Headers(request.headers);
  injectHeaders(headers, rewritten, original);

  const proxied = new Request(rewritten, {
    method: request.method,
    headers,
    body: request.body,
    // Required by undici when streaming a body
    ...(request.body ? { duplex: "half" as const } : {}),
    redirect: request.redirect,
    signal: request.signal,
  });

  try {
    return await baseFetch(proxied);
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    console.warn(
      `[orchid] Proxy connection failed (${String(err)}). Falling back to direct routing: ${original}`,
    );
    const fallbackHeaders = new Headers(request.headers);
    purgeOrchidHeaders(fallbackHeaders);
    return baseFetch(
      new Request(original, {
        method: request.method,
        headers: fallbackHeaders,
        body: request.body,
        ...(request.body ? { duplex: "half" as const } : {}),
        redirect: request.redirect,
        signal: request.signal,
      }),
    );
  }
};

function deriveQueryUrl(): string {
  const explicit = process.env.ORCHID_QUERY_URL;
  if (explicit) return explicit;
  const proxy = new URL(proxyUrl());
  if (proxy.port === "4320") proxy.port = "4321";
  proxy.pathname = "";
  return proxy.toString().replace(/\/+$/, "");
}

async function proxyIsHealthy(): Promise<boolean> {
  const baseFetch = originalFetch ?? globalThis.fetch;
  try {
    const resp = await baseFetch(`${deriveQueryUrl()}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

async function checkPricingSchema(): Promise<void> {
  const baseFetch = originalFetch ?? globalThis.fetch;
  try {
    const headers = new Headers();
    const apiKey = process.env.ORCHID_API_KEY;
    if (apiKey) {
      headers.set("X-Orchid-Api-Key", apiKey);
    }
    const signal = typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(1500)
      : undefined;
    const resp = await baseFetch(`${deriveQueryUrl()}/v1/pricing`, {
      headers,
      signal,
    });
    if (resp.status === 200) {
      const data = await resp.json();
      if (!data || Object.keys(data).length === 0) {
        console.warn(
          "[orchid] Warning: No pricing schema is configured on the Orchid proxy. All captured exchanges will have NULL cost."
        );
      }
    }
  } catch {
    // Fail-safe: do not let diagnostics fail the startup path
  }
}

export interface InitOptions {
  /** Skip the proxy health check (also enabled by ORCHID_BYPASS_HEALTHCHECK=True or under vitest). */
  bypassHealthCheck?: boolean;
}

/**
 * Initializes the Orchid Thin SDK environment.
 *
 * Checks if the Orchid Proxy is online via health check. If online, patches
 * `globalThis.fetch` to route LLM requests through the Orchid Proxy and
 * overrides `OPENAI_BASE_URL`. If the proxy is offline, fail-soft (direct
 * routing) is maintained and no patch is applied.
 *
 * Call this at the entry point of your application, before instantiating any
 * LLM clients.
 */
export async function init(options: InitOptions = {}): Promise<void> {
  // Reset fallback flag on every init invocation to allow retry
  offlineFallback = false;

  // Mock google-auth-library default credentials in replay mode
  if (process.env.ORCHID_MODE === "replay") {
    try {
      // @ts-ignore
      const gauth = await import("google-auth-library");
      if (!googleAuthLibraryPatched && gauth.GoogleAuth) {
        originalGetClient = gauth.GoogleAuth.prototype.getClient;
        originalGetCredentials = gauth.GoogleAuth.prototype.getCredentials;
        originalGetProjectId = gauth.GoogleAuth.prototype.getProjectId;
        patchedGauth = gauth;

        class OrchidReplayClient extends gauth.OAuth2Client {
          constructor() {
            super();
            this.credentials = { access_token: "orchid-replay-dummy-token" };
          }
          async getRequestHeaders(url?: string) {
            return {
              Authorization: "Bearer orchid-replay-dummy-token",
            };
          }
          async getAccessToken() {
            return { token: "orchid-replay-dummy-token" };
          }
        }

        gauth.GoogleAuth.prototype.getClient = async function () {
          return new OrchidReplayClient();
        };
        gauth.GoogleAuth.prototype.getCredentials = async function () {
          return {
            client_email: "orchid-replay-dummy@project.iam.gserviceaccount.com",
            private_key: "dummy-key",
          };
        };
        gauth.GoogleAuth.prototype.getProjectId = async function () {
          return "orchid-replay-project";
        };
        googleAuthLibraryPatched = true;
      }
    } catch {
      // Ignore if google-auth-library is not installed
    }
  }

  const proxy = proxyUrl();
  let parsed: URL;
  try {
    parsed = new URL(proxy);
  } catch {
    throw new Error(`Malformed ORCHID_PROXY_URL: ${proxy}`);
  }
  if (!parsed.protocol || !parsed.host) {
    throw new Error(`Malformed ORCHID_PROXY_URL: ${proxy}`);
  }

  const bypass =
    options.bypassHealthCheck === true ||
    (options.bypassHealthCheck !== false &&
      (process.env.ORCHID_BYPASS_HEALTHCHECK === "True" ||
        process.env.VITEST !== undefined));

  if (!bypass) {
    offlineFallback = !(await proxyIsHealthy());
    if (!offlineFallback) {
      await checkPricingSchema();
    }
  }

  if (!offlineFallback) {
    setEnvIfAbsent("OPENAI_BASE_URL", proxy);
  }

  if (!patched && !offlineFallback) {
    originalFetch = globalThis.fetch;
    globalThis.fetch = orchidFetch;
    patchHttp();
    patched = true;
  }
}

/** Restores the original global fetch and HTTP/HTTPS patch. Intended for tests. */
export function uninstall(): void {
  if (patched && originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = undefined;
  }
  unpatchHttp();
  patched = false;
  // Clean up only the env vars that orchid-sdk itself set.
  for (const key of ownedEnvVars) delete process.env[key];
  ownedEnvVars.clear();
  offlineFallback = false;

  if (googleAuthLibraryPatched && patchedGauth) {
    patchedGauth.GoogleAuth.prototype.getClient = originalGetClient;
    patchedGauth.GoogleAuth.prototype.getCredentials = originalGetCredentials;
    patchedGauth.GoogleAuth.prototype.getProjectId = originalGetProjectId;
    googleAuthLibraryPatched = false;
    patchedGauth = undefined;
  }
}
