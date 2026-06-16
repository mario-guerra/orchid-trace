# Web Visualizer

## Overview

The Web Visualizer is an embedded React-based single-page application that provides a visual timeline of your agent's execution. It allows you to step through exchanges, inspect request/response payloads, analyze token usage, and view calculated costs.

## Steps

### Step 1: Access the Visualizer

Open your web browser and navigate to `http://localhost:4321`.

### Step 2: Select a Session

On the welcome screen, select a session from the **Recent Sessions** list, or use the session selector dropdown in the header to load a specific run.

### Step 3: Step Through the Timeline

Use the left timeline panel to select individual exchanges. You can step through them sequentially using the **Next** and **Previous** buttons or keyboard shortcuts.

### Step 4: Inspect Payloads and Metadata

Use the tabs in the inspector panel to view:
* **Rendered**: A formatted view of the prompt and completion text.
* **Headers**: Redacted request and response headers.
* **Usage**: Detailed token allocation (prompt vs. completion) and calculated USD cost.
* **JSON**: The raw JSON request and response bodies.

## Configuration Options

Configure the visualizer behavior using the following environment variables:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `VITE_DEMO_MODE` | Set to `true` to run the frontend in static demo mode using pre-packaged mock data. | `false` |

## Troubleshooting

### Symptom: Welcome screen shows "Loading sessions..." indefinitely

* **Cause**: The frontend cannot connect to the Orchid Query API on port 4321.
* **Fix**: Verify that the Orchid Proxy container is running and that port 4321 is correctly mapped and accessible.