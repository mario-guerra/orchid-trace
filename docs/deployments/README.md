# Cloud Deployments

This guide gets Orchid Proxy running on a cloud server with one copy-paste. You paste a single configuration snippet into your cloud provider's "create VM" screen, wait a couple of minutes, and the proxy is up with Docker installed, a fresh API key generated, and recordings persisted to disk. No manual server setup.

Orchid is local-first, so a remote deployment is only needed when you want a shared proxy for a team or a staging environment. If you just want to record traffic on your own machine, follow the [Getting Started](../getting_started.md) guide instead.

## How It Works

Every major cloud provider's VM creation screen accepts a startup configuration in a standard format called cloud-init. The snippet below installs Docker, generates an Orchid API key, and starts the proxy automatically on first boot. You never SSH in to set anything up, only to retrieve your key.

## Step 1. Copy the Configuration

Copy this entire block:

```yaml
#cloud-config
write_files:
  - path: /opt/orchid/docker-compose.yml
    permissions: "0644"
    content: |
      services:
        proxy:
          image: ghcr.io/mario-guerra/orchid-proxy:latest
          container_name: orchid-proxy
          restart: always
          ports:
            - "4320:4320"
            - "4321:4321"
          environment:
            ORCHID_BIND_HOST: 0.0.0.0
            ORCHID_API_KEY: "${ORCHID_API_KEY}"
            ORCHID_DB_PATH: /data/orchid.db
          volumes:
            - /data:/data
runcmd:
  - curl -fsSL https://get.docker.com | sh
  - mkdir -p /data
  - chown -R 10001:10001 /data
  - sh -c 'echo "ORCHID_API_KEY=$(docker run --rm ghcr.io/mario-guerra/orchid-proxy:latest generate-api-key)" > /opt/orchid/.env'
  - chmod 600 /opt/orchid/.env
  - sh -c 'cd /opt/orchid && docker compose up -d'
```

## Step 2. Create the VM and Paste It

Create the smallest standard VM your provider offers (1 vCPU and 1 GB RAM is enough) with an **Ubuntu 22.04 LTS** image, and paste the configuration into the field listed below. Everything else can stay at the defaults, including the firewall, which should allow inbound SSH on port `22` only. Keep ports `4320` and `4321` closed; Step 4 explains how to connect safely without opening them.

| Provider | Where to paste it |
|---|---|
| AWS EC2 | Launch instance, expand **Advanced details**, paste into **User data** |
| GCP Compute Engine | Create instance, expand **Advanced options**, then **Management**, add a metadata entry with key `user-data` and the snippet as the value |
| Azure Virtual Machines | Create VM, go to the **Advanced** tab, paste into **Custom data** |
| DigitalOcean | Create Droplet, check **Add initialization scripts**, paste into **User data** |

Make sure you can SSH to the VM (add your SSH key during creation if your provider asks).

## Step 3. Get Your API Key

Give the VM two or three minutes after it boots. The first boot downloads Docker and the Orchid image, so it takes a moment.

SSH in and print the key:

```bash
ssh <user>@<server-ip>
sudo cat /opt/orchid/.env
```

You will see one line, `ORCHID_API_KEY=orchid_live_...`. Copy the key into a password manager now. You will need it to connect the SDK, MCP clients, and the web visualizer.

While you are there, confirm the proxy is healthy (this endpoint requires no auth):

```bash
curl http://localhost:4321/health
```

Expected:

```json
{"status": "ok"}
```

If the health check fails, the first boot may still be running. Check progress with `sudo cloud-init status` and container logs with `sudo docker logs orchid-proxy`.

## Step 4. Connect From Your Laptop

Orchid serves plain HTTP. Even though every data endpoint requires the API key, the key itself and all recorded traffic (your prompts, completions, and upstream credentials) travel unencrypted. That is why ports `4320` and `4321` stay closed and you connect through an SSH tunnel instead. SSH encrypts everything in transit, and there are no TLS certificates to manage.

On your laptop, open the tunnel and leave it running:

```bash
ssh -L 4320:localhost:4320 -L 4321:localhost:4321 <user>@<server-ip>
```

Your local tools now reach the remote proxy at `localhost`, as if it were running on your own machine. Configure your application environment:

- Set `ORCHID_PROXY_URL=http://localhost:4320/v1` (note the `/v1` path, matching the default in the [Configuration Reference](../configuration.md))
- Set `ORCHID_API_KEY` to the key you saved in Step 3

Open `http://localhost:4321` in a browser to reach the web visualizer, and see the [MCP Server Guide](../features/mcp_server.md) for connecting IDE assistants over the streamable HTTP transport.

Port `4320` is the intercepting proxy your application traffic flows through. Port `4321` serves the query API, web visualizer, and MCP endpoint.

If you must expose the ports directly instead of tunneling, restrict your cloud firewall to known client and developer IPs. Do not open `4320` or `4321` to `0.0.0.0/0`.

## Ongoing Care

### Upgrades

SSH into the VM, pull the newest image, and restart. Your database and key are untouched:

```bash
sudo sh -c 'cd /opt/orchid && docker compose pull && docker compose up -d'
```

### Backups

The entire recording history is one SQLite file at `/data/orchid.db`. The simplest backup is your provider's disk snapshot feature. To copy the file manually, stop the container first so you do not capture a mid-write state:

```bash
sudo sh -c 'cd /opt/orchid && docker compose stop'
sudo cp /data/orchid.db /data/orchid.db.bak
sudo sh -c 'cd /opt/orchid && docker compose start'
```

### If the VM Is Replaced

The database lives on the VM's disk. If you delete the VM, take a disk snapshot first, or copy `/data/orchid.db` somewhere safe, then restore it to `/data/orchid.db` on the new VM before the container starts.
