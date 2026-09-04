# Orchid Desktop public beta for macOS

Orchid Desktop records and replays supported AI-provider traffic from a command that Orchid launches. The public beta is intentionally narrow: Apple Silicon macOS and the exact application versions shown by `orchid profile list`.

## Before installing

- Use an Apple Silicon Mac.
- Download `Orchid-<version>-macos-arm64.zip` and its `.sha256` file from the GitHub prerelease.
- Do not use Orchid with sensitive production traffic during the beta. Captured request and response data is stored locally.
- Orchid does not provide system-wide capture, a same-user security boundary, HTTP/2 or gRPC interception, or certificate-pin bypass.

## Verify and install

From the directory containing both downloaded files:

```bash
shasum -a 256 -c Orchid-<version>-macos-arm64.zip.sha256
unzip Orchid-<version>-macos-arm64.zip
```

Move `Orchid.app` to `/Applications` using Finder, then verify Apple's signature and notarization assessment:

```bash
codesign --verify --deep --strict --verbose=2 /Applications/Orchid.app
spctl --assess --type execute --verbose=4 /Applications/Orchid.app
```

For convenience, define the CLI path for the remaining examples:

```bash
ORCHID=/Applications/Orchid.app/Contents/MacOS/orchid
"$ORCHID" --version
"$ORCHID" doctor
"$ORCHID" profile list
```

Only applications and versions printed by `profile list` are supported beta profiles. Generic proxy compatibility is not a support claim.

## Enable explicit TLS interception

Orchid never changes trust settings without an explicit command and exact certificate fingerprint.

```bash
"$ORCHID" ca init
"$ORCHID" ca status
```

Copy the displayed SHA-256 fingerprint, preview the trust operation, and then approve that exact certificate:

```bash
"$ORCHID" ca trust <fingerprint>
"$ORCHID" ca trust <fingerprint> --yes
"$ORCHID" doctor
```

This changes only the current user's login Keychain. Keep the fingerprint for removal.

## Capture a supported command

Use a named session and launch the supported client through Orchid:

```bash
"$ORCHID" run --session beta-example --mode capture --intercept-tls -- <supported-command> <arguments>
```

The child receives temporary authenticated proxy and trust configuration. Orchid removes the launch context when the child exits. Other applications are not automatically routed through Orchid.

Messages such as `destination-rejected (statsig.anthropic.com)` indicate that optional traffic outside Orchid's fixed provider registry was not intercepted. They do not by themselves indicate that the provider request failed.

## Inspect recordings

```bash
"$ORCHID" ui
```

The command starts the local authenticated UI and opens a one-use bootstrap URL. It does not require an Orchid API key in desktop mode. The default database is:

```text
~/Library/Application Support/Orchid/orchid.db
```

## Replay

Replay requires the same session, working directory, client version, and semantically equivalent request:

```bash
"$ORCHID" run --session beta-example --mode replay --intercept-tls -- <supported-command> <arguments>
```

A replay hit does not contact the model provider. A replay miss fails closed unless `--replay-miss-fallback` is explicitly supplied.

## Pause, diagnose, and remove trust

```bash
"$ORCHID" policy pause
"$ORCHID" doctor
"$ORCHID" audit history
"$ORCHID" ca untrust <fingerprint>
"$ORCHID" ca untrust <fingerprint> --yes
```

After removing Keychain trust, delete `Orchid.app` from `/Applications` if Orchid is no longer needed. Local recordings and CA files remain under Orchid's Application Support directory so removal is not mistaken for data deletion.

## Beta limitations

- Apple Silicon only; Intel is not a supported target.
- Compatibility is application- and version-specific.
- Capture applies only to processes launched with `orchid run` that honor the supplied proxy and trust configuration.
- TLS interception is limited to source-reviewed provider hosts and HTTP/1.1 semantics.
- Unknown or denied destinations are opaque or rejected according to policy; Orchid does not silently expand interception.
- Certificate-pinned clients are unsupported.
- Another process running as the same macOS user is outside Orchid's security boundary.
- Captures are bounded and may be metadata-only when payload limits are exceeded.

Report a beta issue with the output of `orchid --version`, `orchid doctor`, the supported-client version, and the redacted error. Never include provider keys, proxy credentials, captured prompts, or captured responses.
