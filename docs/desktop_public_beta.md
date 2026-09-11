# Test the Orchid Desktop public beta on macOS

This guide walks through one complete test: install Orchid, capture a small custom-agent or verified Claude Code request, inspect it locally, replay it without another provider call, and remove Orchid's certificate trust.

No knowledge of proxies or certificates is required. Read each explanation before running its command.

> [!IMPORTANT]
> Orchid Desktop is a narrow public beta for Apple Silicon M4-and-later Macs and only the exact client versions listed by `orchid profile list`. The beta was validated on one M4 Pro Mac running macOS 26.1; compatibility with other M4-and-later hardware or macOS versions is an assumption, not verified coverage. Do not use sensitive production prompts during testing.

## What Orchid does

Orchid launches a supported client with temporary network settings. Traffic from that launched process goes through a local proxy that:

1. accepts connections only from the launch Orchid created;
2. reads requests only for Orchid's built-in provider hosts or exact DNS hosts you explicitly enroll;
3. sends capture requests to the real provider and stores the response locally; and
4. can later replay a matching response without contacting the provider.

Orchid does **not** record every application on the Mac. Closing the launched command removes its temporary proxy context.

## Before starting

You need:

- an Apple Silicon M4-or-later Mac (`arm64`);
- the Orchid ZIP and matching `.sha256` file from the [GitHub Releases page](https://github.com/mario-guerra/orchid/releases);
- a client and version shown by `orchid profile list`; and
- working access to that client's AI provider.

For the currently verified Claude Code profile, provider access can be either:

- a Claude Pro or Max login; or
- an Anthropic Console API key with API billing enabled, exported as `ANTHROPIC_API_KEY`.

A provider key pays for live model requests. It is different from `ORCHID_API_KEY`, which protects a network-accessible Orchid server and is not needed by the local Desktop UI.

## 1. Verify the download

Open Terminal and change to the directory containing both downloaded files. Replace `<version>` with the release number, such as `0.1.13`; do not type the angle brackets.

```bash
cd ~/Downloads
shasum -a 256 -c Orchid-<version>-macos-arm64.zip.sha256
```

Expected result:

```text
Orchid-<version>-macos-arm64.zip: OK
```

`OK` means the ZIP matches the file published with the release. Stop if it says `FAILED`.

Unzip the application:

```bash
unzip Orchid-<version>-macos-arm64.zip
```

Move `Orchid.app` into the **Applications** folder with Finder. If an older copy exists, quit it and replace it.

## 2. Verify Apple's security checks

Run both commands:

```bash
codesign --verify --deep --strict --verbose=2 /Applications/Orchid.app
spctl --assess --type execute --verbose=4 /Applications/Orchid.app
```

Expected results include:

- `valid on disk` and `satisfies its Designated Requirement`; and
- `accepted` with `source=Notarized Developer ID`.

Stop if either command fails. Do not bypass a Gatekeeper warning for an unverified build.

## 3. Run the Desktop UI qualification

Open **Orchid** from Applications. Verified clients launch directly; custom agents start from an Orchid-owned terminal so the user—not the renderer—enters the command:

1. In **Settings**, choose **Prepare local CA**. Confirm that the displayed SHA-256 fingerprint contains no private-key material.
2. Choose **Review login-Keychain trust**, then approve the native dialog. The dialog must name the exact fingerprint, operation, and current-user login-Keychain scope.
3. Return to **Home**, choose **My own agent or CLI** or **Verified Claude Code**, select a project with the native folder picker, and optionally enter a session name and known-cost guard. For a custom agent, approve the unverified terminal boundary, select **Open agent terminal**, and enter the project's normal start command in that terminal.
4. Verify the terminal receives keyboard input, resizes with the window, and returns focus to the controls with Control-Option-O. Confirm that capture is described as limited to the launched process tree.
5. Submit one harmless prompt, open **Inspector**, and confirm the captured exchange appears. Stop the session and verify the UI reports cleanup rather than only process exit.
6. In **History**, open the capture in Inspector. Then select **Replay** on Home, choose that immutable source, leave miss fallback off, and launch a distinct run. A replay miss must fail locally; enabling fallback may contact the provider and records any miss in the new run.
7. In **Settings**, export redacted diagnostics to a new file. Confirm it contains build/platform, database-health schema, and lifecycle audit metadata but no prompt, response, terminal text, credentials, private key, or project path.
8. For a custom agent, confirm child processes using Anthropic, OpenAI, and Vertex REST remain within the launched process tree and appear in the same capture. gRPC traffic is inspect-only and detached descendants are outside guaranteed cleanup.
9. Test keyboard-only operation and 200% zoom. If VoiceOver is available, verify controls have useful names and terminal output is not announced line by line.
10. Review trust removal in Settings and cancel the native confirmation once to verify no mutation. Approve it only when the test is complete.

Normal app deletion does not remove the login-Keychain trust entry, local CA, captures, policy, audit, or preferences. Remove trust explicitly in Settings before uninstalling when desired. Local data remains owner-private under Orchid's application-data directory until explicitly removed.

The remaining CLI procedure is a diagnostic and compatibility fallback; it is not required for the primary Desktop flow.

## CLI fallback: Set a shorter command name

The executable is inside the application bundle. Define `ORCHID` once in each new terminal:

```bash
ORCHID=/Applications/Orchid.app/Contents/MacOS/orchid
```

Confirm that the application starts:

```bash
"$ORCHID" --version
"$ORCHID" doctor
"$ORCHID" profile list
```

For release `0.1.13`, the version output starts with `orchid 0.1.13`. The profile list shows the exact supported client versions. A nearby or newer version is not automatically supported.

## 4. Create and trust Orchid's local certificate

### Why this is required

HTTPS normally prevents an intermediary from reading a request. Orchid creates a private local certificate authority (CA) so the client or attached agent process tree it launches can establish encrypted connections to Orchid. Orchid then creates separate encrypted connections to the real providers.

Orchid creates the CA locally and never changes Keychain trust without an explicit confirmation.

Create the CA and display its SHA-256 fingerprint:

```bash
"$ORCHID" ca init
"$ORCHID" ca status
```

Copy the complete fingerprint from `ca status`. In the next commands, replace `<fingerprint>` with that value.

First preview the change:

```bash
"$ORCHID" ca trust <fingerprint>
```

Then explicitly approve it:

```bash
"$ORCHID" ca trust <fingerprint> --yes
"$ORCHID" ca keychain-status <fingerprint>
"$ORCHID" doctor
```

Expected result: `keychain-status` says the exact Orchid CA is present in the current user's login Keychain. Orchid does not install a system-wide certificate.

Keep the fingerprint. It is required to remove the exact certificate later.

## 5. Prepare the supported client

Check the client version before spending money on a capture. For the verified Claude Code profile:

```bash
/opt/homebrew/bin/claude --version
```

Compare it with:

```bash
"$ORCHID" profile list
```

If using Anthropic API billing, load the key into the current shell without placing it in shell history:

```bash
read -r -s ANTHROPIC_API_KEY
echo
export ANTHROPIC_API_KEY
```

The terminal waits silently after the first command. Paste the key and press Return. The key is not displayed.

To load an existing trusted `.env` file instead, change to the directory containing it and run:

```bash
set -a
source .env
set +a
```

Only source a file that you created or reviewed because `source` executes shell commands in that file. Never commit a real provider key.

### Optional: set a personal session budget

Set a positive dollar amount before `orchid run` to stop later captured requests once the session's known subtotal reaches that amount:

```bash
export ORCHID_SESSION_BUDGET_USD=0.05
```

Orchid checks the subtotal before each captured request. If a previous call has unknown cost, it blocks the next request with `409 Conflict` and `X-Orchid-Budget-Blocked: cost_unknown`. If the known subtotal has reached the limit, it returns `402 Payment Required` and `X-Orchid-Budget-Blocked: limit_reached`.

This is a pre-request threshold, not a reservation: a request that starts below the limit can exceed it, and concurrent requests can jointly exceed it. It does not cap the provider invoice. Remove the setting with `unset ORCHID_SESSION_BUDGET_USD` when the test ends.

### Optional: enroll another exact host

The built-in exact hosts are `api.openai.com`, `api.anthropic.com`, and the direct Gemini Developer API host `generativelanguage.googleapis.com`. They seed new and legacy policies by default. A policy that already contains an explicit enrollment list remains unchanged, so add the Gemini host manually if it is absent. To capture another HTTPS API, enroll its exact DNS host before starting the child process:

```bash
"$ORCHID" interception add api.example.com
"$ORCHID" interception list
```

Enrollment accepts exact public DNS names only—never wildcards, IP literals, single-label names, or `.local` names. DNS is checked on every connection, and the entire connection is rejected if any answer is private or otherwise non-public. `interception remove api.example.com` restores opaque tunneling for future launches. `policy deny` temporarily disables an enrolled host; policy changes never alter an already-running launch.

A legacy policy file without an enrollment list starts with the built-in provider hosts. Its first policy update writes an explicit sorted list. An explicitly empty list stays empty.

## 6. Capture one live request

Change to the project directory you want to use for both capture and replay. Replay matching can depend on the working directory and complete request shape.

```bash
cd /path/to/your/project
```

Run a small Claude Code request through Orchid:

```bash
printf '%s\n' 'Reply exactly: orchid.' |
  "$ORCHID" run \
    --session personal-beta-test \
    --mode capture \
    --intercept-tls \
    -- /opt/homebrew/bin/claude -p \
      --model haiku \
      --tools '' \
      --permission-mode dontAsk \
      --output-format json
```

This is a real provider call and may incur a small charge. A successful result contains:

```text
"is_error":false
"result":"orchid."
```

Orchid also prints `intercepted (api.anthropic.com)`. Unenrolled hosts use opaque CONNECT tunnels and are not recorded. A `destination-rejected` message instead means the connection failed Orchid's port, authority, or public-address checks.

## 7. Inspect the recording

Start the local Desktop UI:

```bash
"$ORCHID" ui
```

Orchid opens a browser using a one-use authentication URL. The local Desktop UI does not ask for `ORCHID_API_KEY`.

In the browser:

1. select the `personal-beta-test` session;
2. open the completed Anthropic exchange;
3. confirm the HTTP status is `200`;
4. inspect the request, response, duration, and token counts; and
5. confirm secrets are redacted from recorded headers.

Keep the terminal open while using the UI. Press **Control-C** in that terminal to stop it.

Recordings are stored at:

```text
~/Library/Application Support/Orchid/orchid.db
```

Treat this database as private because it can contain prompts and responses.

## 8. Replay without another provider call

Use the same directory, session name, prompt, client version, and command options used for capture:

```bash
cd /path/to/your/project
printf '%s\n' 'Reply exactly: orchid.' |
  "$ORCHID" run \
    --session personal-beta-test \
    --mode replay \
    --intercept-tls \
    -- /opt/homebrew/bin/claude -p \
      --model haiku \
      --tools '' \
      --permission-mode dontAsk \
      --output-format json
```

Expected result:

- the response is again `orchid.`;
- provider usage and provider cost reported for this invocation are zero; and
- there is no `Orchid Replay Miss` error.

By default, a replay miss fails with HTTP 404 instead of contacting the provider. `--replay-miss-fallback` allows a miss to become a live paid request, so do not add it when testing offline replay.

## 9. Pause or resume interception

Pausing affects future launches. Existing processes keep the policy snapshot with which they started.

```bash
"$ORCHID" policy pause
"$ORCHID" policy status
"$ORCHID" policy resume
```

When paused, new launches use opaque HTTPS tunnels and are not captured or replayed.

## 10. Diagnose a problem

Start with these commands:

```bash
"$ORCHID" --version
"$ORCHID" doctor
"$ORCHID" profile list
"$ORCHID" policy status
"$ORCHID" audit history
```

See [Troubleshooting](./troubleshooting.md) for common errors. When reporting a beta issue, include the command outputs above, the client version, macOS version, and the redacted error message.

Never include provider keys, Orchid proxy credentials, captured prompts, captured responses, or the database in an issue.

## 11. Remove trust and uninstall

Display the fingerprint again if needed:

```bash
"$ORCHID" ca status
```

Preview removal, then explicitly approve removal of that exact certificate:

```bash
"$ORCHID" ca untrust <fingerprint>
"$ORCHID" ca untrust <fingerprint> --yes
"$ORCHID" ca keychain-status <fingerprint>
```

Delete `Orchid.app` from **Applications** using Finder.

Deleting the application does not delete recordings or CA files. They remain in:

```text
~/Library/Application Support/Orchid/
```

Review that directory before deleting it. Make sure no recordings need to be retained.

## Test completion checklist

A personal beta test is complete when all boxes are true:

- [ ] The checksum reported `OK`.
- [ ] `codesign` and Gatekeeper accepted the application.
- [ ] `orchid doctor` completed successfully.
- [ ] The client version exactly matched a listed profile.
- [ ] The exact Orchid CA appeared in the login Keychain.
- [ ] Capture returned the expected live model response.
- [ ] The UI displayed the captured exchange.
- [ ] Replay returned the same response without provider usage.
- [ ] No provider key appeared in the UI or logs.
- [ ] Certificate trust was removed when testing finished.

## Protocol and capability matrix

| Traffic from an enrolled host | Forwarding and capture | Semantic decoding | Replay |
| --- | --- | --- | --- |
| HTTP/1.1 | Supported | Provider adapter when available; otherwise generic request/response data | Supported only for complete, bounded, replayable captures |
| HTTP/2 | Supported after TLS ALPN | Same as HTTP/1.1 | Same request-level constraints as HTTP/1.1 |
| Server-Sent Events | Forwarded live | Provider-specific; unknown providers retain the UTF-8 event stream without claiming semantic decoding | Supported only when the stream completes within the capture limit |
| gRPC unary | Forwarded over intercepted HTTP/2; request and response messages plus trailers are captured | Protobuf payload stays opaque without descriptors; compression flags and message lengths are recorded | Inspect-only; replay fails with `422` and `X-Orchid-Replay-Unsupported` |
| gRPC server streaming | Forwarded with bounded backpressure; ordered response messages and trailers are captured | Same descriptor-free framing capture as unary | Inspect-only; replay fails loudly |
| gRPC client streaming or bidirectional streaming | Forwarded without changing wire data, then explicitly marked unsupported when multiple request messages are observed | Framing remains inspectable, but Orchid does not claim supported RPC semantics | Unsupported |
| WebSocket Upgrade | HTTP/1.1 upgrades are forwarded and bounded frame transcripts are captured | Frame-level only; payload semantics are not inferred | Inspect-only |
| Cooperative browser WebRTC | Media remains peer-to-peer; the optional browser SDK records lifecycle, privacy-reduced ICE/TURN and RTP summaries, plus application-supplied transcript/tool/timing events | No SDP, candidate addresses, media samples, or transparent SRTP inspection | Unsupported |
| Tunneled CONNECT inside intercepted TLS | Rejected with `501` | Unsupported | Unsupported |
| HTTP/3 and QUIC | Not intercepted by this TCP CONNECT proxy | Unsupported | Unsupported |

HTTP/2 is terminated by Orchid and independently negotiated upstream. Capture is request-level translation, not preservation of HTTP/2 frames, stream IDs, priorities, or wire framing. gRPC detection requires an `application/grpc` media type on intercepted HTTP/2. Orchid incrementally parses the five-byte gRPC message prefix (one compression byte and four-byte big-endian length), retains opaque protobuf bytes without descriptors, and forwards data and trailers unchanged with bounded channels. It records message direction, order, relative timing, compression/framing flags, content type, and response trailers including `grpc-status` and `grpc-message` when present.

A gRPC transcript retains at most 256 events, 8 MiB total payload, and 1 MiB per message; forwarding continues after capture truncation. Cancellation or incomplete framing is recorded as an incomplete transcript. Because descriptor-free protobuf requests cannot currently be matched and reconstructed with sufficient safety, all gRPC captures are inspect-only. Replay fails before contacting the provider rather than guessing. Unary and server-streaming describe observed message counts, not universal service compatibility; clients that bypass proxy variables, use QUIC, pin certificates, require unsupported HTTP/2 extensions, or use untested gRPC implementations remain outside verified support.

Built-in semantic decoding covers OpenAI Chat Completions and Responses API paths, Azure OpenAI with deployment-aware attribution, Anthropic Messages, direct Gemini Developer API `/v1/models/...` and `/v1beta/models/...` paths, regional and customer-specific Vertex endpoints, and Bedrock Converse/EventStream with CRC-validated framing. Bedrock SigV4 request material is forwarded unchanged, while sensitive credentials are redacted from storage. Unknown models and unsupported billing dimensions retain unknown pricing. Other enrolled hosts use generic capture; enrollment alone does not add provider-specific decoding.

Replay identity includes session, provider or exact hostname, method, path, and semantic request hash. Existing captures use the legacy format and are retained for inspection but are not silently reused by the new replay contract. Metadata-only logging, multipart requests, declared trailer-dependent traffic, incomplete streams, and request or response bodies over the capture limit are explicitly marked unreplayable; replay returns `422` with `X-Orchid-Replay-Unsupported` unless live fallback was explicitly enabled. Outside the dedicated gRPC path, HTTP/2 trailers that were not declared in headers cannot be identified by the generic data-stream forwarding path, so Orchid cannot guarantee trailer-aware capture or replay.

## Public-beta limits

- Apple Silicon M4 and later only; Intel Macs are unsupported. One M4 Pro on macOS 26.1 was validated; other M4-and-later hardware and macOS versions are assumed compatible but unverified.
- Compatibility remains client- and version-specific.
- Only processes launched by `orchid run` receive proxy environment variables. Direct sockets, custom transports, clients that ignore those variables, and QUIC can bypass Orchid; universal capture is not guaranteed.
- Orchid cannot and does not bypass certificate pinning. A pinned client rejects Orchid's generated leaf certificate.
- Unknown or denied destinations remain opaque or are rejected according to policy.
- Other processes running as the same macOS user are outside Orchid's security boundary.
- Captures are bounded and may become metadata-only and explicitly unreplayable when payload limits are exceeded.
