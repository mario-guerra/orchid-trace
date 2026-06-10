# Storage Persistence & Network Mount Guide

Because `orchid-proxy` uses SQLite, the database (`orchid.db`) is a single file on disk. When deploying to serverless container hosts (like Azure Container Apps, AWS Fargate, or GCP Cloud Run), the local container filesystem is **ephemeral**—any restarts or scaling events will permanently wipe your telemetry.

To keep data persistent, you must mount an external network share. However, because SQLite relies on standard OS-level file locking (`fcntl`), the choice of network filesystem has severe performance and stability implications.

---

## 1. The SQLite File-Locking Model

SQLite does not have a database server daemon. Instead, the `orchid-proxy` application process writes directly to the file. To coordinate concurrent read/write operations safely, SQLite uses POSIX byte-range locks (`fcntl` system calls) on the database file.

On local SSDs, these locks are instantaneous (microsecond latency). On network-attached storage, lock states must be synchronized across a network protocol, which introduces high latency and lock flakiness.

---

## 2. Cloud Network Share Comparison

If you mount external filesystems into the `/data` folder, here is how the standard cloud offerings behave:

| Network Volume Service | Protocol | SQLite Compatibility | Performance & Latency |
| :--- | :--- | :--- | :--- |
| **AWS EFS** (Elastic File System) | NFS v4 | **Supported** | **Medium**. File locking is supported natively, but every write transaction requires network roundtrips to coordinate locks, leading to higher latency under heavy write loads. |
| **Azure Files** | SMB / CIFS | **Supported** | **Low**. SMB file locking is supported but has high latency and overhead. High-concurrency operations can occasionally trigger database lock timeouts. |
| **GCP Cloud Storage FUSE** | FUSE | **INCOMPATIBLE** | **Crash on Boot**. Google Cloud Storage FUSE does **not** support POSIX byte-range file locking (`fcntl`). SQLite will fail to acquire a lock and crash on startup. |

> [!CAUTION]
> **GCP Cloud Run Warning**: Do **not** map a standard Google Cloud Storage (GCS) Bucket to the proxy container using Cloud Storage FUSE. It will fail. For GCP Cloud Run, you must use **Google Cloud Filestore** (NFS) via a Serverless VPC Access Connector.

---

## 3. How the Proxy Mitigates Locking Issues

To make network mounts as stable as possible, the `orchid-proxy` storage layer initializes SQLite with the following custom database pragmas at boot:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

### Why these settings matter for Network Mounts:
1.  **Write-Ahead Logging (WAL)**: Under default rollback journal mode, writing blocks readers, and reading blocks writers. WAL mode decouples them: readers can read the database file while a writer is appending to the WAL log file. This drastically reduces the lock contention on network mounts.
2.  **Synchronous NORMAL**: This reduces the number of disk sync (`fsync`) operations, writing changes to the WAL file and letting the OS manage flush intervals. This offsets the network-write latency overhead.
3.  **Busy Timeout (5000ms)**: If a write transaction is blocked because a lock is held by another thread or is slow to release over the network, SQLite will wait up to **5 seconds** to acquire the lock before throwing a `database is locked` error.

---

## 4. Recommended Infrastructure Choices

If your workload requires high concurrent request recording, select your hosting environment based on these guidelines:

### Option A: Serverless Containers (Best for low-to-medium write loads)
Mount a persistent network volume to `/data`:
*   **AWS Fargate**: Mount AWS EFS (using NFS v4).
*   **Azure Container Apps**: Mount Azure Files (Premium SSD tier is highly recommended to keep SMB latencies low).
*   **GCP Cloud Run**: Mount GCP Filestore (NFS).

### Option B: Single VM (Best for high-concurrency / performance)
If you are logging thousands of requests per minute, bypass network shares completely:
*   Deploy the proxy container to a single virtual machine (like AWS EC2, Azure VM, or Google Compute Engine).
*   Mount a standard **Block Storage Volume** (AWS EBS, Azure Managed Disk, GCP Persistent Disk) formatted as `ext4` or `xfs`.
*   Block storage acts as a local disk, completely avoiding network-locking overhead.
