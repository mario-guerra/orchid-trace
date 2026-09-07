import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeBatchClient, RealtimeIngestError, WebRTCObserver } from "../src/realtime.js";

function okResponse(): Response {
  return new Response(null, { status: 201 });
}

class FakePeerConnection extends EventTarget {
  signalingState = "stable" as RTCSignalingState;
  connectionState = "new" as RTCPeerConnectionState;
  iceConnectionState = "new" as RTCIceConnectionState;
  iceGatheringState = "new" as RTCIceGatheringState;
  stats = new Map<string, Record<string, unknown>>();

  async getStats(): Promise<RTCStatsReport> {
    return this.stats as unknown as RTCStatsReport;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RealtimeBatchClient", () => {
  it("uses explicit browser configuration and sends ordered bounded batches", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => okResponse());
    const client = new RealtimeBatchClient({
      queryUrl: "https://query.example.test/",
      sessionId: "session/a",
      streamId: "stream-1",
      target: "peer",
      apiKey: "test-key",
      fetch: fetchMock,
      batchSize: 2,
      flushIntervalMs: 0,
    });

    client.record({ eventType: "one", payload: { value: 1 } });
    client.record({ eventType: "two", payload: { value: 2 } });
    client.record({ eventType: "three", payload: { value: 3 } });
    await client.flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://query.example.test/v1/sessions/session%2Fa/realtime");
    const firstInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect((firstInit.headers as Record<string, string>)["X-Orchid-Api-Key"]).toBe("test-key");
    const first = JSON.parse(String(firstInit.body));
    const second = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(first.events.map((event: { sequence_num: number }) => event.sequence_num)).toEqual([0, 1]);
    expect(second.events[0].sequence_num).toBe(2);
    expect(first.stream.session_id).toBe("session/a");
  });

  it("does not POST clean empty batches from the default timer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => okResponse());
    const client = new RealtimeBatchClient({
      queryUrl: "https://query.example.test",
      sessionId: "session-1",
      target: "peer",
      fetch: fetchMock,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)).events).toEqual([]);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    client.updateStream({ state: "open" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)).stream.state).toBe("open");

    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await client.close();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("skips explicit clean flushes and persists updates made during an active flush", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    let requests = 0;
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => {
      requests += 1;
      if (requests === 1) return new Promise<Response>((resolve) => { resolveFirst = resolve; });
      return Promise.resolve(okResponse());
    });
    const client = new RealtimeBatchClient({
      queryUrl: "https://query.example.test",
      sessionId: "session-1",
      target: "peer",
      fetch: fetchMock,
      flushIntervalMs: 0,
    });

    const initialFlush = client.flush();
    client.updateStream({ metadata: { phase: "ready" } });
    const concurrentFlush = client.flush();
    resolveFirst?.(okResponse());
    await Promise.all([initialFlush, concurrentFlush]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(JSON.parse(secondBody.stream.metadata_json)).toEqual({ phase: "ready" });
    await client.flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retains a failed batch and rejects raw audio by default", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => okResponse())
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(okResponse());
    const client = new RealtimeBatchClient({
      queryUrl: "https://query.example.test",
      sessionId: "session-1",
      target: "peer",
      fetch: fetchMock,
      flushIntervalMs: 0,
    });
    client.record({ eventType: "transcript", payload: "hello", contentType: "text/plain" });
    expect(() => client.record({
      eventType: "audio",
      payload: "AAAA",
      contentType: "audio/pcm",
      payloadEncoding: "base64",
    })).toThrow(/disabled/);
    expect(() => client.record({ eventType: "oversized", payload: "x".repeat(512 * 1024 + 1) }))
      .toThrow(/client limit/);

    await expect(client.flush()).rejects.toBeInstanceOf(RealtimeIngestError);
    expect(client.queuedEvents).toBe(1);
    await client.flush();
    expect(client.queuedEvents).toBe(0);
  });

  it("bounds its queue without allocating sequence numbers for dropped events", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => okResponse());
    const client = new RealtimeBatchClient({
      queryUrl: "https://query.example.test",
      sessionId: "session-1",
      target: "peer",
      fetch: fetchMock,
      batchSize: 2,
      maxQueueSize: 2,
      flushIntervalMs: 0,
    });
    client.record({ eventType: "one" });
    client.record({ eventType: "two" });
    expect(client.record({ eventType: "dropped" })).toBe(false);
    expect(client.droppedEvents).toBe(1);
    await client.flush();
  });
});

describe("WebRTCObserver", () => {
  it("captures lifecycle, privacy-reduced ICE/TURN and RTP summaries", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => okResponse());
    const pc = new FakePeerConnection();
    pc.stats.set("transport", { id: "transport", type: "transport", selectedCandidatePairId: "pair" });
    pc.stats.set("pair", {
      id: "pair", type: "candidate-pair", state: "succeeded", nominated: true,
      localCandidateId: "local", remoteCandidateId: "remote", currentRoundTripTime: 0.02,
    });
    pc.stats.set("local", {
      id: "local", type: "local-candidate", candidateType: "relay", protocol: "udp",
      relayProtocol: "udp", address: "192.0.2.1", port: 3478,
    });
    pc.stats.set("remote", {
      id: "remote", type: "remote-candidate", candidateType: "srflx", protocol: "udp",
      address: "198.51.100.1", port: 5000,
    });
    pc.stats.set("codec", { id: "codec", type: "codec", mimeType: "audio/opus" });
    pc.stats.set("rtp", {
      id: "rtp", type: "inbound-rtp", kind: "audio", codecId: "codec",
      packetsReceived: 20, bytesReceived: 4000, jitter: 0.01,
    });
    const observer = new WebRTCObserver({
      peerConnection: pc as unknown as RTCPeerConnection,
      queryUrl: "https://query.example.test",
      sessionId: "session-1",
      target: "peer",
      fetch: fetchMock,
      flushIntervalMs: 0,
      statsIntervalMs: 0,
    });
    pc.connectionState = "connected";
    pc.dispatchEvent(new Event("connectionstatechange"));
    observer.recordTranscript("user", "hello", { final: true });
    observer.recordToolEvent("search", "result", { count: 1 });
    observer.recordTiming("first_token", 42);
    observer.recordArtifact({ uri: "https://artifacts.example.test/a.json", contentType: "application/json" });
    await observer.sampleStats();
    await observer.stop();

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)));
    const serialized = JSON.stringify(bodies);
    const eventTypes = bodies.flatMap((body) => body.events.map((event: { event_type: string }) => event.event_type));
    expect(eventTypes).toEqual(expect.arrayContaining([
      "session.started", "webrtc.connection_state", "transcript", "tool", "timing",
      "artifact.reference", "webrtc.selected_candidate_pair", "webrtc.rtp_summary", "session.ended",
    ]));
    const payloads = bodies.flatMap((body) => body.events.map((event: { payload: string }) => JSON.parse(event.payload)));
    expect(payloads.some((payload) => payload.turnUsed === true)).toBe(true);
    expect(serialized).not.toContain("192.0.2.1");
    expect(serialized).not.toContain("198.51.100.1");
    expect(bodies.at(-1).stream.state).toBe("closed");
  });

  it("serializes stats sampling and allows failed shutdown to be retried", async () => {
    let resolveStats: ((value: RTCStatsReport) => void) | undefined;
    const getStats = vi.fn(() => new Promise<RTCStatsReport>((resolve) => { resolveStats = resolve; }));
    const pc = new FakePeerConnection();
    pc.getStats = getStats;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => okResponse())
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(okResponse());
    const observer = new WebRTCObserver({
      peerConnection: pc as unknown as RTCPeerConnection,
      queryUrl: "https://query.example.test",
      sessionId: "session-1",
      target: "peer",
      fetch: fetchMock,
      flushIntervalMs: 0,
      statsIntervalMs: 0,
    });

    const firstSample = observer.sampleStats();
    const secondSample = observer.sampleStats();
    expect(getStats).toHaveBeenCalledTimes(1);
    resolveStats?.(new Map() as unknown as RTCStatsReport);
    await Promise.all([firstSample, secondSample]);

    await expect(observer.stop()).rejects.toBeInstanceOf(RealtimeIngestError);
    await observer.stop();
    const successfulBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(successfulBody.events.filter((event: { event_type: string }) => event.event_type === "session.ended"))
      .toHaveLength(1);
    expect(successfulBody.stream.state).toBe("closed");
  });

  it("bounds transcript and artifact references", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => okResponse());
    const observer = new WebRTCObserver({
      peerConnection: new FakePeerConnection() as unknown as RTCPeerConnection,
      queryUrl: "https://query.example.test",
      sessionId: "session-1",
      target: "peer",
      fetch: fetchMock,
      flushIntervalMs: 0,
      statsIntervalMs: 0,
      maxTranscriptLength: 256,
    });
    observer.recordTranscript("assistant", "x".repeat(300));
    for (let index = 0; index < 16; index += 1) {
      expect(observer.recordArtifact({ uri: `https://example.test/${index}` })).toBe(true);
    }
    expect(observer.recordArtifact({ uri: "https://example.test/overflow" })).toBe(false);
    await observer.stop();
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    const transcript = body.events.find((event: { event_type: string }) => event.event_type === "transcript");
    expect(transcript.truncated).toBe(true);
    expect(JSON.parse(transcript.payload).text).toHaveLength(256);
  });
});
