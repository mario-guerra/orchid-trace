const MAX_SERVER_BATCH_SIZE = 256;
const DEFAULT_MAX_QUEUE_SIZE = 2_048;
const DEFAULT_MAX_TEXT_LENGTH = 16_384;
const MAX_ARTIFACT_REFERENCES = 16;
const MAX_EVENT_PAYLOAD_BYTES = 512 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_FLAGS_BYTES = 16 * 1024;
const DEFAULT_MAX_QUEUED_BYTES = 8 * 1024 * 1024;

export type RealtimeDirection = "inbound" | "outbound" | "internal";
export type PayloadEncoding = "utf8" | "base64";
export type RealtimeStreamState = "opening" | "open" | "closing" | "closed" | "failed";

export interface RealtimeStream {
  id: string;
  session_id: string;
  exchange_id?: string;
  protocol: string;
  provider?: string;
  target: string;
  started_at: string;
  ended_at?: string;
  state: string;
  replay_capability: string;
  replayability_reason?: string;
  metadata_json: string;
}

export interface RealtimeEvent {
  id: string;
  stream_id: string;
  sequence_num: number;
  direction: RealtimeDirection;
  offset_us: number;
  event_type: string;
  flags_json: string;
  content_type?: string;
  payload_encoding: PayloadEncoding;
  payload: string;
  truncated: boolean;
  recorded_at: string;
}

export interface RealtimeEventInput {
  direction?: RealtimeDirection;
  eventType: string;
  payload?: string | Record<string, unknown> | readonly unknown[];
  flags?: Record<string, unknown>;
  contentType?: string;
  payloadEncoding?: PayloadEncoding;
  truncated?: boolean;
}

export interface RealtimeBatchClientOptions {
  /** Required query/control service URL; no environment-variable lookup is performed. */
  queryUrl: string;
  sessionId: string;
  streamId?: string;
  target: string;
  protocol?: string;
  provider?: string;
  exchangeId?: string;
  apiKey?: string;
  metadata?: Record<string, unknown>;
  fetch?: typeof globalThis.fetch;
  batchSize?: number;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  maxQueuedPayloadBytes?: number;
  /** Raw audio payloads are rejected unless explicitly opted in. */
  allowRawAudio?: boolean;
  onError?: (error: unknown) => void;
}

export class RealtimeIngestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "RealtimeIngestError";
  }
}

function randomId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function boundedJson(value: unknown, label: string, maxBytes: number): string {
  const serialized = json(value);
  if (utf8Bytes(serialized) > maxBytes) throw new RangeError(`${label} exceeds the ${maxBytes} byte limit`);
  return serialized;
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) throw new TypeError("Realtime batching limits must be finite numbers");
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function safeText(value: unknown, maxLength = DEFAULT_MAX_TEXT_LENGTH): { value: string; truncated: boolean } {
  const text = String(value ?? "");
  return text.length <= maxLength
    ? { value: text, truncated: false }
    : { value: text.slice(0, maxLength), truncated: true };
}

/** Browser-safe, ordered, bounded client for Orchid's cooperative realtime ingest API. */
export class RealtimeBatchClient {
  readonly stream: RealtimeStream;
  readonly batchSize: number;
  readonly maxQueueSize: number;
  readonly maxQueuedPayloadBytes: number;
  readonly allowRawAudio: boolean;

  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly flushIntervalMs: number;
  private readonly onError?: (error: unknown) => void;
  private readonly queue: RealtimeEvent[] = [];
  private readonly startedMs = Date.now();
  private sequence = 0;
  private dropped = 0;
  private queuedBytes = 0;
  private lastOffsetUs = 0;
  private timer?: ReturnType<typeof globalThis.setInterval>;
  private activeFlush?: Promise<void>;
  private streamRevision = 0;
  private persistedStreamRevision = -1;
  private closed = false;

  constructor(options: RealtimeBatchClientOptions) {
    if (!options.queryUrl || !options.sessionId || !options.target) {
      throw new TypeError("queryUrl, sessionId, and target are required");
    }
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") throw new TypeError("A browser-compatible fetch implementation is required");
    this.batchSize = clampInteger(options.batchSize, 64, 1, MAX_SERVER_BATCH_SIZE);
    this.maxQueueSize = clampInteger(options.maxQueueSize, DEFAULT_MAX_QUEUE_SIZE, this.batchSize, 10_000);
    this.maxQueuedPayloadBytes = clampInteger(
      options.maxQueuedPayloadBytes,
      DEFAULT_MAX_QUEUED_BYTES,
      1_024,
      64 * 1024 * 1024,
    );
    this.flushIntervalMs = clampInteger(options.flushIntervalMs, 1_000, 0, 60_000);
    this.allowRawAudio = options.allowRawAudio === true;
    this.onError = options.onError;
    const base = options.queryUrl.replace(/\/+$/, "");
    this.endpoint = `${base}/v1/sessions/${encodeURIComponent(options.sessionId)}/realtime`;
    this.headers = { "Content-Type": "application/json" };
    if (options.apiKey) this.headers["X-Orchid-Api-Key"] = options.apiKey;
    this.stream = {
      id: options.streamId ?? randomId("rtc"),
      session_id: options.sessionId,
      ...(options.exchangeId ? { exchange_id: options.exchangeId } : {}),
      protocol: options.protocol ?? "webrtc",
      ...(options.provider ? { provider: options.provider } : {}),
      target: options.target,
      started_at: new Date(this.startedMs).toISOString(),
      state: "opening",
      replay_capability: "captured_inspectable",
      replayability_reason: "WebRTC media is observed as summaries; raw media is not recorded",
      metadata_json: boundedJson(options.metadata, "Stream metadata", MAX_METADATA_BYTES),
    };
    if (this.flushIntervalMs > 0) {
      this.timer = globalThis.setInterval(() => void this.flush().catch(this.reportError), this.flushIntervalMs);
    }
  }

  get queuedEvents(): number { return this.queue.length; }
  get droppedEvents(): number { return this.dropped; }

  updateStream(update: { state?: RealtimeStreamState; endedAt?: string; metadata?: Record<string, unknown> }): void {
    const metadataJson = update.metadata === undefined
      ? undefined
      : boundedJson(update.metadata, "Stream metadata", MAX_METADATA_BYTES);
    let changed = false;
    if (update.state !== undefined) {
      this.stream.state = update.state;
      changed = true;
    }
    if (update.endedAt !== undefined) {
      this.stream.ended_at = update.endedAt;
      changed = true;
    }
    if (metadataJson !== undefined) {
      this.stream.metadata_json = metadataJson;
      changed = true;
    }
    if (changed) this.streamRevision += 1;
  }

  record(input: RealtimeEventInput): boolean {
    if (this.closed) return false;
    const contentType = input.contentType ?? "application/json";
    if (!this.allowRawAudio && (contentType.toLowerCase().startsWith("audio/") || input.payloadEncoding === "base64")) {
      throw new TypeError("Raw audio/binary payload capture is disabled; use artifact references or RTP summaries");
    }
    const payload = typeof input.payload === "string" ? input.payload : json(input.payload);
    const payloadBytes = utf8Bytes(payload);
    if (payloadBytes > MAX_EVENT_PAYLOAD_BYTES) {
      throw new RangeError(`Realtime event payload exceeds the ${MAX_EVENT_PAYLOAD_BYTES} byte client limit`);
    }
    const flagsJson = boundedJson(input.flags, "Event flags", MAX_FLAGS_BYTES);
    if (this.queue.length >= this.maxQueueSize || this.queuedBytes + payloadBytes > this.maxQueuedPayloadBytes) {
      this.dropped += 1;
      return false;
    }
    const now = Date.now();
    this.lastOffsetUs = Math.max(this.lastOffsetUs, Math.max(0, (now - this.startedMs) * 1_000));
    this.queue.push({
      id: randomId("evt"),
      stream_id: this.stream.id,
      sequence_num: this.sequence++,
      direction: input.direction ?? "internal",
      offset_us: this.lastOffsetUs,
      event_type: input.eventType,
      flags_json: flagsJson,
      content_type: contentType,
      payload_encoding: input.payloadEncoding ?? "utf8",
      payload,
      truncated: input.truncated ?? false,
      recorded_at: new Date(now).toISOString(),
    });
    this.queuedBytes += payloadBytes;
    if (this.queue.length >= this.batchSize) void this.flush().catch(this.reportError);
    return true;
  }

  async flush(): Promise<void> {
    if (this.activeFlush) return this.activeFlush;
    this.activeFlush = this.flushQueued().finally(() => { this.activeFlush = undefined; });
    return this.activeFlush;
  }

  private async flushQueued(): Promise<void> {
    // The initial dirty revision creates the stream. Later zero-event requests are
    // only needed for lifecycle or metadata changes.
    while (this.queue.length > 0 || this.persistedStreamRevision !== this.streamRevision) {
      const events = this.queue.slice(0, this.batchSize);
      const sentStreamRevision = this.streamRevision;
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ stream: { ...this.stream }, events }),
      });
      if (!response.ok) {
        const detail = safeText(await response.text(), 512).value;
        throw new RealtimeIngestError(response.status, `Realtime ingest failed (${response.status})${detail ? `: ${detail}` : ""}`);
      }
      this.persistedStreamRevision = sentStreamRevision;
      if (events.length > 0) {
        this.queue.splice(0, events.length);
        this.queuedBytes -= events.reduce((total, event) => total + utf8Bytes(event.payload), 0);
      }
    }
  }

  async close(state: "closed" | "failed" = "closed"): Promise<void> {
    if (this.closed) return;
    if (this.timer !== undefined) globalThis.clearInterval(this.timer);
    // Let an in-flight append finish, then persist the final stream state even
    // when that append already drained the event queue.
    if (this.activeFlush) await this.activeFlush;
    this.updateStream({ state, endedAt: new Date().toISOString() });
    await this.flush();
    this.closed = true;
  }

  private readonly reportError = (error: unknown): void => {
    this.onError?.(error);
  };
}

export interface WebRTCObserverOptions extends RealtimeBatchClientOptions {
  peerConnection: RTCPeerConnection;
  statsIntervalMs?: number;
  maxTranscriptLength?: number;
}

export interface ArtifactReference {
  uri: string;
  name?: string;
  contentType?: string;
  sizeBytes?: number;
  sha256?: string;
}

type StatsLike = { id?: string; type?: string; [key: string]: unknown };

function statsValues(report: RTCStatsReport): StatsLike[] {
  const values: StatsLike[] = [];
  report.forEach((item) => values.push(item as StatsLike));
  return values;
}

function candidateSummary(candidate: StatsLike | undefined): Record<string, unknown> | undefined {
  if (!candidate) return undefined;
  // Deliberately exclude address, IP, port, URL, username fragments, and SDP.
  return {
    candidateType: candidate.candidateType,
    protocol: candidate.protocol,
    relayProtocol: candidate.relayProtocol,
    tcpType: candidate.tcpType,
    networkType: candidate.networkType,
  };
}

/** Cooperative RTCPeerConnection observer. It never reads MediaStreamTrack data. */
export class WebRTCObserver {
  readonly client: RealtimeBatchClient;
  private readonly pc: RTCPeerConnection;
  private readonly maxTranscriptLength: number;
  private readonly listeners: Array<[string, EventListener]> = [];
  private statsTimer?: ReturnType<typeof globalThis.setInterval>;
  private artifactCount = 0;
  private lastPairId?: string;
  private statsSample?: Promise<void>;
  private stopPromise?: Promise<void>;
  private stopInitiated = false;
  private stopped = false;

  constructor(options: WebRTCObserverOptions) {
    this.pc = options.peerConnection;
    this.maxTranscriptLength = clampInteger(options.maxTranscriptLength, DEFAULT_MAX_TEXT_LENGTH, 256, 262_144);
    this.client = new RealtimeBatchClient(options);
    this.observe("negotiationneeded", () => this.event("webrtc.negotiation_needed"));
    this.observe("signalingstatechange", () => this.event("webrtc.signaling_state", { state: this.pc.signalingState }));
    this.observe("connectionstatechange", () => {
      this.event("webrtc.connection_state", { state: this.pc.connectionState });
      if (this.pc.connectionState === "connected") this.client.updateStream({ state: "open" });
      else if (this.pc.connectionState === "failed") this.client.updateStream({ state: "failed" });
    });
    this.observe("iceconnectionstatechange", () => this.event("webrtc.ice_connection_state", { state: this.pc.iceConnectionState }));
    this.observe("icegatheringstatechange", () => this.event("webrtc.ice_gathering_state", { state: this.pc.iceGatheringState }));
    this.observe("icecandidate", (raw) => {
      const candidate = (raw as RTCPeerConnectionIceEvent).candidate;
      this.event("webrtc.ice_candidate", candidate ? {
        candidateType: candidate.type,
        protocol: candidate.protocol,
        relayProtocol: (candidate as RTCIceCandidate & { relayProtocol?: string }).relayProtocol,
        tcpType: candidate.tcpType,
      } : { complete: true });
    });
    this.observe("icecandidateerror", (raw) => {
      const error = raw as RTCPeerConnectionIceErrorEvent;
      this.recordError("ice", error.errorText || `ICE error ${error.errorCode}`, { errorCode: error.errorCode });
    });
    this.event("session.started", {
      signalingState: this.pc.signalingState,
      connectionState: this.pc.connectionState,
      iceConnectionState: this.pc.iceConnectionState,
    });
    const requestedStatsInterval = clampInteger(options.statsIntervalMs, 5_000, 0, 60_000);
    const statsInterval = requestedStatsInterval === 0 ? 0 : Math.max(250, requestedStatsInterval);
    if (statsInterval > 0) {
      this.statsTimer = globalThis.setInterval(() => void this.sampleStats().catch((error) => this.recordError("stats", error)), statsInterval);
    }
  }

  private observe(type: string, listener: EventListener): void {
    this.pc.addEventListener(type, listener);
    this.listeners.push([type, listener]);
  }

  private event(eventType: string, payload: Record<string, unknown> = {}, direction: RealtimeDirection = "internal"): boolean {
    return this.client.record({ eventType, payload, direction });
  }

  recordTranscript(role: string, text: string, options: { final?: boolean; language?: string; direction?: RealtimeDirection } = {}): boolean {
    const bounded = safeText(text, this.maxTranscriptLength);
    return this.client.record({
      eventType: "transcript",
      direction: options.direction ?? (role === "user" ? "inbound" : "outbound"),
      payload: { role: safeText(role, 64).value, text: bounded.value, final: options.final ?? false, language: options.language },
      truncated: bounded.truncated,
    });
  }

  recordToolEvent(name: string, phase: "start" | "result" | "error", details: unknown = {}, callId?: string): boolean {
    const bounded = safeText(json(details), this.maxTranscriptLength);
    return this.client.record({
      eventType: "tool",
      direction: phase === "start" ? "outbound" : "inbound",
      payload: { name: safeText(name, 256).value, phase, callId: callId ? safeText(callId, 256).value : undefined, details: bounded.value },
      truncated: bounded.truncated,
    });
  }

  recordTiming(name: string, durationMs: number, attributes: Record<string, unknown> = {}): boolean {
    return this.event("timing", { name: safeText(name, 256).value, durationMs, attributes });
  }

  recordError(source: string, error: unknown, attributes: Record<string, unknown> = {}): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error && error.stack ? safeText(error.stack, 4_096) : undefined;
    return this.event("error", {
      source: safeText(source, 128).value,
      message: safeText(message, 2_048).value,
      stack: stack?.value,
      attributes,
    });
  }

  recordArtifact(reference: ArtifactReference): boolean {
    if (this.artifactCount >= MAX_ARTIFACT_REFERENCES) return false;
    const uri = safeText(reference.uri, 2_048);
    if (!uri.value) throw new TypeError("Artifact reference URI is required");
    this.artifactCount += 1;
    return this.event("artifact.reference", {
      uri: uri.value,
      name: reference.name ? safeText(reference.name, 256).value : undefined,
      contentType: reference.contentType ? safeText(reference.contentType, 256).value : undefined,
      sizeBytes: reference.sizeBytes,
      sha256: reference.sha256 ? safeText(reference.sha256, 128).value : undefined,
    });
  }

  async sampleStats(): Promise<void> {
    if (this.stopped || this.stopInitiated) return;
    if (this.statsSample) return this.statsSample;
    this.statsSample = this.collectStats().finally(() => { this.statsSample = undefined; });
    return this.statsSample;
  }

  private async collectStats(): Promise<void> {
    const values = statsValues(await this.pc.getStats());
    const byId = new Map(values.filter((item) => item.id).map((item) => [item.id!, item]));
    const transport = values.find((item) => item.type === "transport" && item.selectedCandidatePairId);
    const pair = (transport?.selectedCandidatePairId
      ? byId.get(String(transport.selectedCandidatePairId))
      : values.find((item) => item.type === "candidate-pair" && item.state === "succeeded" && (item.nominated || item.selected))) as StatsLike | undefined;
    if (pair) {
      const local = byId.get(String(pair.localCandidateId));
      const remote = byId.get(String(pair.remoteCandidateId));
      const pairId = String(pair.id ?? "selected");
      this.client.record({
        eventType: "webrtc.selected_candidate_pair",
        payload: {
          changed: pairId !== this.lastPairId,
          local: candidateSummary(local),
          remote: candidateSummary(remote),
          turnUsed: local?.candidateType === "relay" || remote?.candidateType === "relay",
          currentRoundTripTime: pair.currentRoundTripTime,
          availableOutgoingBitrate: pair.availableOutgoingBitrate,
        },
      });
      this.lastPairId = pairId;
    }
    const rtp = values
      .filter((item) => item.type === "inbound-rtp" || item.type === "outbound-rtp" || item.type === "remote-inbound-rtp")
      .slice(0, 64)
      .map((item) => ({
        direction: item.type,
        kind: item.kind ?? item.mediaType,
        codec: item.codecId ? byId.get(String(item.codecId))?.mimeType : undefined,
        packetsSent: item.packetsSent,
        packetsReceived: item.packetsReceived,
        packetsLost: item.packetsLost,
        bytesSent: item.bytesSent,
        bytesReceived: item.bytesReceived,
        jitter: item.jitter,
        roundTripTime: item.roundTripTime,
        framesEncoded: item.framesEncoded,
        framesDecoded: item.framesDecoded,
      }));
    if (rtp.length > 0) this.client.record({ eventType: "webrtc.rtp_summary", payload: { streams: rtp } });
  }

  async stop(state: "closed" | "failed" = "closed"): Promise<void> {
    if (this.stopped) return;
    if (this.stopPromise) return this.stopPromise;
    if (!this.stopInitiated) {
      this.stopInitiated = true;
      if (this.statsTimer !== undefined) globalThis.clearInterval(this.statsTimer);
      for (const [type, listener] of this.listeners) this.pc.removeEventListener(type, listener);
    }
    this.stopPromise = (async () => {
      if (this.statsSample) await this.statsSample;
      if (!this.stopped && this.client.stream.state !== state) this.client.updateStream({ state });
      if (!this.stopped && this.client.stream.ended_at === undefined) this.event("session.ended", { state });
      await this.client.close(state);
      this.stopped = true;
    })().finally(() => { this.stopPromise = undefined; });
    return this.stopPromise;
  }
}
