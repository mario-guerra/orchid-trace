import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Control client for managing the Orchid capture/replay database.
 * Provides methods to perform health checks, export captured sessions,
 * and import fixtures into the Orchid Proxy.
 */
export class OrchidControlClient {
  readonly queryUrl: string;
  readonly apiKey?: string;

  /**
   * @param queryUrl URL of the Orchid Query service (default: http://127.0.0.1:4321).
   * @param apiKey API key for authenticating with the control plane.
   */
  constructor(queryUrl?: string, apiKey?: string) {
    this.queryUrl =
      queryUrl ?? process.env.ORCHID_QUERY_URL ?? "http://127.0.0.1:4321";
    this.apiKey = apiKey ?? process.env.ORCHID_API_KEY ?? undefined;
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { "X-Orchid-Api-Key": this.apiKey } : {};
  }

  /** Checks the health of the Orchid Query service. */
  async checkHealth(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.queryUrl}/health`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
      });
      return resp.status === 200;
    } catch (err) {
      console.warn(`[orchid] Query service health check failed: ${String(err)}`);
      return false;
    }
  }

  /**
   * Exports all captured exchanges for a session from the proxy and saves
   * them to a local JSON fixture file.
   */
  async exportFixture(sessionId: string, path: string): Promise<boolean> {
    try {
      const resp = await fetch(
        `${this.queryUrl}/v1/sessions/${encodeURIComponent(sessionId)}/export`,
        { headers: this.headers() },
      );
      if (resp.status === 404) {
        console.warn(`[orchid] Session ${sessionId} not found to export.`);
        return false;
      }
      if (!resp.ok) {
        throw new Error(`Export failed with status ${resp.status}`);
      }
      const fixture = await resp.json();
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(fixture, null, 2));
      return true;
    } catch (err) {
      console.warn(
        `[orchid] Failed to export fixture for session ${sessionId} to ${path}: ${String(err)}`,
      );
      return false;
    }
  }

  /**
   * Reads a local JSON fixture file and imports its exchanges into the
   * Orchid Proxy database.
   *
   * @throws If the fixture file does not exist or the import request fails.
   */
  async importFixture(path: string): Promise<boolean> {
    const raw = await readFile(path, "utf-8");
    const fixture = JSON.parse(raw);

    const resp = await fetch(`${this.queryUrl}/v1/sessions/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.headers() },
      body: JSON.stringify(fixture),
    });
    if (!resp.ok) {
      throw new Error(`Import failed with status ${resp.status}`);
    }
    return resp.status === 201;
  }
}
