# Pi inference manager (GPU host)

This Stow package is installed only on the R9700 host. The manager is the sole owner of Studio/router mode transitions and grants one expiring GPU lease at a time. Normal clients use team leases; host maintenance uses a local-only maintenance lease.

The checked-in nginx file is a deployment template for certificate-verified HTTPS. The manager requires a dedicated high-entropy control bearer on every remote request; the model API uses a separate key. Validate the template with `nginx -t` and verify an unauthenticated request returns HTTP 401 before provisioning clients.

## Updating the pinned Pi llama.cpp runtime

Unsloth Studio updates its own build independently. After updating Studio and confirming its bundled `llama-server` works, preview promotion into the Pi router:

```bash
pi-llama-update
```

The preview compares `~/.unsloth/llama.cpp/build` with the immutable runtime selected by `~/.local/opt/pi-llama-server/current`. Apply only while no managed inference lease is active:

```bash
pi-llama-update --apply
```

The updater validates the version, required router flags, R9700 ROCm visibility, and a complete persisted file manifest. It acquires a maintenance lease available only through the mode-0600 local Unix socket; this fences remote clients and keeps both inference services stopped even if the manager restarts. It then atomically changes the `current` symlink, starts and verifies the exact router executable, checks `/health`, and releases the lease while restoring the previous mode in one manager transaction. A failed health check switches the selector back to the previous runtime. If recovery itself fails, the maintenance lease is retained as a bounded safety fence. Old runtime directories are retained rather than deleted.

Rollback is also dry-run-first:

```bash
pi-llama-update --rollback 87d9271bd
pi-llama-update --rollback 87d9271bd --apply
```

Do not run the Studio installer and `pi-llama-update` concurrently. Stop Studio before applying the promotion so its build cannot change while being copied.
