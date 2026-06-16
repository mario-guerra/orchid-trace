# Replay Testing

## Overview

Deterministic Replay Testing allows you to run your agent's integration tests completely offline using recorded local JSON fixtures. This eliminates external API costs, reduces test latency, and ensures your test suite is fully deterministic.

## Steps

### Step 1: Annotate Your Test with the Replay Helper

Wrap your test function using the replay decorator or helper.

For Python applications:
```python
from orchid import replay
import openai

client = openai.OpenAI()

@replay("tests/fixtures/test_user_greeting.json")
def test_user_greeting():
    response = client.chat.completions.create(
        model="gpt-5.5",
        messages=[{"role": "user", "content": "Say hello!"}]
    )
    assert "hello" in response.choices[0].message.content.lower()
```

For TypeScript/JavaScript applications:
```typescript
import { withReplay } from "orchid-sdk";
import OpenAI from "openai";

const client = new OpenAI();

test("user greeting", () =>
  withReplay("tests/fixtures/test_user_greeting.json", async () => {
    const response = await client.chat.completions.create({
      model: "gpt-5.5",
      messages: [{ role: "user", content: "Say hello!" }],
    });
    expect(response.choices[0].message.content.toLowerCase()).toContain("hello");
  }));
```

For Rust applications, testing is managed using a custom `reqwest-middleware` setup that intercepts requests and maps session controls natively. Refer to the [Rust Integration Guide](./rust_integration.md) for a complete walkthrough and code examples.


### Step 2: Record the Fixture

Set the `ORCHID_RECORD` environment variable to `1` and run your test suite. This executes the live API calls and saves the results to the specified JSON fixture file.

```bash
ORCHID_RECORD=1 pytest tests/
```

### Step 3: Run Offline Replay

Unset `ORCHID_RECORD` (or set it to `0`) and run your test suite again. The SDK will import the local fixture into the proxy and serve the mocked responses with zero external network calls.

```bash
ORCHID_RECORD=0 pytest tests/
```

## Configuration Options

Configure the replay behavior using the following environment variables:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `ORCHID_RECORD` | Set to `1`, `true`, or `yes` to run replay helpers in capture/record mode. | `0` |
| `ORCHID_FLUSH_SLEEP` | Delay in seconds before exporting a captured session to allow async logs to flush. | `0.2` |

*Note: The `ORCHID_RECORD` and `ORCHID_FLUSH_SLEEP` variables are processed automatically by the Python (`@replay`) and TypeScript (`withReplay`) SDK test decorators. Because Rust integration uses a custom native middleware, you can inspect environment variables or write a lightweight `with_replay` helper to manage importing and exporting fixtures automatically.*


## Troubleshooting

### Symptom: Test fails with a mock error or missing match

* **Cause**: The prompt or request payload has changed, causing the semantic hash to mismatch the recorded fixture.
* **Fix**: Re-run the test with `ORCHID_RECORD=1` to update the recorded JSON fixture with the new request shape.

### Symptom: Fixture file not found error

* **Cause**: The specified fixture path does not exist and `ORCHID_RECORD` is not set to `1`.
* **Fix**: Ensure the path is correct, or run the test with `ORCHID_RECORD=1` first to generate the fixture file.