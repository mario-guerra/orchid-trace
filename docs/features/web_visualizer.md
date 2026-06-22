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

## Live Refresh (Active Session)

When a session is open in the visualizer, new exchanges captured by the proxy appear automatically — no manual page reload required. The viewer polls the query API every 3 seconds and appends any new exchanges to the timeline in real time.

* New exchanges are always appended in sequence order. Your current selection and any active filter are preserved between polls.
* Live refresh is active only while a session is open and is automatically paused when you navigate back to the dashboard or close the tab.
* Live refresh is disabled in demo mode (`VITE_DEMO_MODE=true`).

## Managing Sessions and Exchanges

### Clearing Exchanges

To delete all recorded exchanges from a session **without** removing the session itself (useful for resetting a run while keeping the session name active):

* **From within an open session**: Click the **Eraser** icon (⌫) in the top-right header. Confirm the prompt. The timeline clears immediately and the exchange counter resets to zero.
* **Via MCP tool**: Call `clear_session_exchanges` with the target `session_id`.

### Deleting a Session

To permanently delete a session and all its exchanges from the database:

* **From the Sessions Dashboard**: Hover over any session row and click the **Trash** icon (🗑) that appears on the right side. Confirm the prompt. The session is removed from the list immediately.
* **From within an open session**: Click the **Trash** icon (🗑) in the top-right header (next to the Eraser). Confirm the prompt. The session is deleted and the view returns to the dashboard.
* **Via MCP tool**: Call `delete_session` with the target `session_id`.

> **Note:** Both operations are permanent. There is no undo. Retention-based auto-pruning (`--retention-days`, `--max-db-mb`) also deletes sessions automatically in the background.

## Keyboard Shortcuts

| Key | Action |
| :--- | :--- |
| `j` / `↓` | Next exchange |
| `k` / `↑` | Previous exchange |
| `f` | Focus filter input |
| `Home` | Jump to first exchange |
| `End` | Jump to last exchange |

## Configuration Options

Configure the visualizer behavior using the following environment variables:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `VITE_DEMO_MODE` | Set to `true` to run the frontend in static demo mode using pre-packaged mock data. | `false` |

## Troubleshooting

### Symptom: Welcome screen shows "Loading sessions..." indefinitely

* **Cause**: The frontend cannot connect to the Orchid Query API on port 4321.
* **Fix**: Verify that the Orchid Proxy container is running and that port 4321 is correctly mapped and accessible.

### Symptom: New exchanges don't appear during an active recording

* **Cause**: The live refresh poll is failing silently (e.g. the proxy was restarted mid-session).
* **Fix**: Open the browser DevTools console and look for `[pollNewExchanges] fetch failed` warnings. Reload the page to re-establish the connection, then reopen the session.