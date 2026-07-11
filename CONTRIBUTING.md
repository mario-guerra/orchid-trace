# Contributing to Orchid

Thanks for helping improve Orchid. This repository contains the public SDKs and
documentation for Orchid's AI agent observability workflow.

Content here is synced from the main development repository. Issues and
discussions are welcome; pull requests may be ported rather than merged directly.

## Ways to Contribute

- Report bugs in the Python or TypeScript SDKs, documentation, replay fixtures,
  MCP integration, or published proxy behavior.
- Suggest feature improvements for SDK methods, MCP tools, replay fidelity,
  proxy configuration, visualizer workflows, or docs.
- Improve examples, troubleshooting notes, and setup instructions.
- Add or update tests for SDK behavior and offline replay flows.

## Reporting Bugs

Open an issue with enough detail to reproduce the problem:

- Orchid SDK and language version, such as `orchid-sdk` for Python or npm.
- Runtime details: Python, Node.js, operating system, Docker version, and whether
  the proxy was local or remote.
- Relevant proxy logs, SDK warnings, MCP tool output, and HTTP status codes.
- The session ID, mode (`capture`, `replay`, or `passthrough`), and any replay
  fixture shape needed to reproduce the issue.
- Minimal code or commands that trigger the behavior.

Do not include real API keys, authorization headers, customer prompts, private
trace payloads, or production data. Redact secrets before attaching logs or
fixtures.

## Suggesting Features

When proposing a feature, describe:

- The user workflow or debugging problem it solves.
- Which surface it affects: Python SDK, TypeScript SDK, proxy configuration, MCP
  tools, visualizer, replay fixtures, or docs.
- Expected behavior in capture, replay, and fail-soft fallback paths.
- Compatibility concerns for existing SDK users or recorded fixtures.

## Development Setup

Clone the repository and work from the component you are changing.

### Python SDK

```bash
cd sdk/python
python -m venv .venv
. .venv/bin/activate
python -m pip install -e .
python -m pip install pytest pytest-asyncio requests aiohttp
python -m pytest
```

The Python package requires Python 3.8 or newer and depends on `httpx`.

### TypeScript SDK

```bash
cd sdk/typescript
npm install
npm test
npm run typecheck
npm run build
```

The TypeScript package requires Node.js 18 or newer.

### Proxy and Visualizer

The proxy source is not part of this repository. Use the published container
image when validating SDK behavior against a running proxy:

```bash
docker pull ghcr.io/mario-guerra/orchid-proxy:latest
docker run -d \
  --name orchid-proxy \
  -p 4320:4320 \
  -p 4321:4321 \
  -v orchid-data:/data \
  -e ORCHID_API_KEY=your-secure-api-key \
  -e ORCHID_DB_PATH=/data/orchid.db \
  ghcr.io/mario-guerra/orchid-proxy:latest
```

Use placeholder keys in examples and tests. Never commit a real `ORCHID_API_KEY`
or upstream provider credential.

## Testing Expectations

- Add focused tests for SDK behavior changes.
- Keep replay tests deterministic and offline by default.
- Use `ORCHID_RECORD=1` only when intentionally refreshing fixtures from live
  calls, then inspect fixtures before committing them.
- Cover capture, replay, passthrough, and fail-soft behavior when a change
  affects request routing or proxy availability.
- For MCP-related changes, include the MCP tool output or manual verification
  steps in the pull request.

## Code Style

- Keep SDK APIs thin and predictable. Orchid should route and annotate traffic
  without forcing application code to change its LLM client patterns.
- Preserve fail-soft behavior: if the proxy is unreachable, SDKs should avoid
  breaking the host application.
- Avoid logging secrets or Orchid control headers that may contain keys.
- Keep Python changes compatible with Python 3.8+.
- Keep TypeScript changes compatible with Node.js 18+ and native `fetch`.
- Prefer small, reviewable patches over broad rewrites.

## Documentation

Update documentation when behavior changes:

- Root overview and quick start: `README.md`
- Python SDK usage: `sdk/python/README.md`
- TypeScript SDK usage: `sdk/typescript/README.md`
- Configuration: `docs/configuration.md`
- Replay testing: `docs/features/replay_testing.md`
- MCP server behavior: `docs/features/mcp_server.md`
- Troubleshooting: `docs/troubleshooting.md`

Keep examples consistent across Python and TypeScript where both SDKs support the
same concept.

## Pull Request Process

1. Confirm there is no open pull request already covering the issue.
2. Keep the PR focused on one change.
3. Include tests or explain why the change is documentation-only.
4. Update docs for user-facing behavior changes.
5. Summarize validation commands and any manual proxy or MCP checks.
6. Note if the change may need to be ported into the main development repository.

## Security

Report security-sensitive issues privately when they involve credential exposure,
proxy authentication bypass, replay fixture leakage, MCP access control, or
secret redaction failures.

For public issues and pull requests:

- Use dummy tokens such as `your-secure-api-key`.
- Redact authorization headers, cookies, API keys, provider tokens, and customer
  prompt data.
- Do not attach production Orchid databases or raw trace exports.
- Verify new examples preserve the security model described in `README.md` and
  `docs/configuration.md`.
