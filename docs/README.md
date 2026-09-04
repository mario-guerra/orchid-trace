# Orchid user documentation

Orchid records AI-provider requests so that you can inspect and replay them while debugging an AI application or coding agent.

You do not need to understand proxy internals to get started. Choose the setup that matches what you want to run.

## Choose a setup

| Goal | Start here | What you need |
|---|---|---|
| Test Orchid Desktop with a supported application on a Mac | [macOS Desktop public beta](./desktop_public_beta.md) | Apple Silicon Mac, a supported client version, and provider access |
| Add Orchid to an application with Docker and an SDK | [Docker and SDK getting started](./getting_started.md) | Docker and a Python or Node.js application |
| Look up a setting | [Configuration](./configuration.md) | An existing Orchid installation |
| Fix a problem | [Troubleshooting](./troubleshooting.md) | The exact error and `orchid doctor` output |
| Call the Query API directly | [API reference](./api_reference.md) | A running Orchid proxy |

## Desktop and server mode are different

Orchid currently has two ways to run:

- **Desktop beta:** the `orchid` command launches one supported application with temporary proxy settings. It stores captures locally and includes a local visualizer. Start here when testing Claude Code on an Apple Silicon Mac.
- **Container/server:** `orchid-proxy` runs as a service, usually in Docker. An application uses an Orchid SDK or explicitly sends requests through that service. Start here when integrating Orchid into application code.

Commands and configuration for one mode do not always apply to the other. Each guide labels the mode it covers.

## Important terms

- **Provider:** the service that receives the AI request, such as Anthropic or OpenAI.
- **Client:** the program making that request, such as Claude Code or an application using an AI SDK.
- **Capture:** one live request goes to the provider and Orchid stores the request and response. A capture can incur provider charges.
- **Replay:** Orchid returns a previously captured response instead of contacting the provider.
- **Session:** the name that groups related captured exchanges.
- **TLS interception:** Orchid temporarily reads encrypted traffic from the client it launches. This requires trusting Orchid's local certificate authority (CA).
- **Orchid API key:** protects access to an Orchid server. It is not an Anthropic or OpenAI key.
- **Provider API key:** authorizes paid requests to an AI provider. Orchid does not create or replace this key.

## Security and privacy

Captured prompts and responses may contain private data. Keep the Orchid database private, use test prompts during evaluation, and redact issue reports. Never post provider keys, Orchid proxy credentials, prompts, responses, or the database itself in a public issue.
