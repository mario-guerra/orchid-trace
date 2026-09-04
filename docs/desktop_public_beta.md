# Test the Orchid Desktop public beta on macOS

This guide walks through one complete test: install Orchid, capture a small Claude Code request, inspect it in the browser, replay it without another provider call, and remove Orchid's certificate trust.

No knowledge of proxies or certificates is required. Read each explanation before running its command.

> [!IMPORTANT]
> Orchid Desktop is a narrow public beta. It supports Apple Silicon Macs and only the exact client versions listed by `orchid profile list`. Do not use sensitive production prompts during testing.

## What Orchid does

Orchid launches a supported client with temporary network settings. Traffic from that launched process goes through a local proxy that:

1. accepts connections only from the launch Orchid created;
2. reads requests only for provider domains in Orchid's fixed registry;
3. sends capture requests to the real provider and stores the response locally; and
4. can later replay a matching response without contacting the provider.

Orchid does **not** record every application on the Mac. Closing the launched command removes its temporary proxy context.

## Before starting

You need:

- an Apple Silicon Mac (`arm64`);
- the Orchid ZIP and matching `.sha256` file from the [GitHub Releases page](https://github.com/mario-guerra/orchid/releases);
- a client and version shown by `orchid profile list`; and
- working access to that client's AI provider.

For the currently verified Claude Code profile, provider access can be either:

- a Claude Pro or Max login; or
- an Anthropic Console API key with API billing enabled, exported as `ANTHROPIC_API_KEY`.

A provider key pays for live model requests. It is different from `ORCHID_API_KEY`, which protects a network-accessible Orchid server and is not needed by the local Desktop UI.

## 1. Verify the download

Open Terminal and change to the directory containing both downloaded files. Replace `<version>` with the release number, such as `0.1.5`; do not type the angle brackets.

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

## 3. Set a shorter command name

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

For release `0.1.5`, the version output starts with `orchid 0.1.5`. The profile list shows the exact supported client versions. A nearby or newer version is not automatically supported.

## 4. Create and trust Orchid's local certificate

### Why this is required

HTTPS normally prevents an intermediary from reading a request. Orchid creates a private local certificate authority (CA) so the one client it launches can establish an encrypted connection to Orchid. Orchid then creates a separate encrypted connection to the real provider.

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

Orchid also prints `intercepted (api.anthropic.com)`. Messages about `destination-rejected (statsig.anthropic.com)` are expected: optional Anthropic telemetry is outside Orchid's fixed provider registry. Those messages do not mean the model request failed.

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

## Public-beta limits

- Apple Silicon only; Intel Macs are unsupported.
- Compatibility is client- and version-specific.
- Only processes launched by `orchid run` receive Orchid's proxy settings.
- TLS interception is limited to source-reviewed provider hosts and HTTP/1.1 semantics.
- Orchid does not bypass certificate pinning.
- HTTP/2, gRPC, and HTTP/3 interception are unsupported.
- Unknown or denied destinations remain opaque or are rejected according to policy.
- Other processes running as the same macOS user are outside Orchid's security boundary.
- Captures are bounded and may become metadata-only when payload limits are exceeded.
