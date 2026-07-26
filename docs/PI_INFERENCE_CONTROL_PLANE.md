# Pi inference control plane

## Purpose

The R9700 has one inference owner at a time. `llm.malo.tn.it` is the model data plane; service switching and global ownership belong to a separate control plane. Local and remote Pi clients use the same shared `pi-inference` command.

```text
Pi / three-agent extension
  ├─ model traffic ─────► https://llm.malo.tn.it/v1
  └─ lifecycle traffic ─► pi-inference
                            ├─ local Unix socket, or
                            └─ https://inference.malo.tn.it/v1
                                      │
                               pi-inference-manager
                                      │
                         unsloth.service / pi-llama-router.service
```

## Stow packages

The shared client is part of `pi` and is installed on every machine:

```bash
cd ~/dotfiles
stow -t "$HOME" pi
```

The shared client supports POSIX Python 3.9 or newer. The GPU-host manager uses `tomllib` and therefore requires Python 3.11 or newer.

The GPU host additionally installs:

```bash
stow -t "$HOME" pi-inference-host
systemctl --user daemon-reload
systemctl --user enable --now pi-inference-manager.service
```

Do not enable the service until both credentials below have been provisioned. Runtime state, lease IDs, authorization records, and credentials are never stored in the dotfiles repository.

## Credentials

Each client needs the model API key accepted by `pi-llama-router.service`. A remote client additionally needs the separate control API token and its own mTLS certificate/private-key pair. Install bearer credentials without putting values in shell history:

```bash
pi-inference credential --install model-api
pi-inference credential --install control-api
```

Replacing a credential is explicit:

```bash
pi-inference credential --install --replace model-api
```

Bearer files are written mode `0600` beneath `~/.pi-inference/credentials/`. Place `control-client.crt` and mode-`0600` `control-client.key` there as well. This directory is deliberately outside every Stow package, so installing a secret can never follow a configuration symlink back into the dotfiles checkout. Never reuse the model key as the control token, and never share one client private key between machines. The GPU host's `model-api-key` must contain a key present in llama.cpp's configured API-key file.

Generate the control token on the GPU host with at least 256 bits of entropy, then provision the same token only to authorized clients. For example, capture `openssl rand -base64 32` through a password manager rather than shell history.

## Commands

These commands are identical on local and remote clients:

```bash
pi-inference status
pi-inference acquire --mode team --owner host:repo:task --ttl 300
pi-inference renew --owner host:repo:task --ttl 300
pi-inference release --owner host:repo:task
pi-inference team
pi-inference studio
pi-inference stop
```

`acquire` creates one opaque client-generated lease ID and persists only a mode-0600 client record. The manager stores only its SHA-256 hash. Acquisition is idempotent for the same owner and ID. An expired lease can be replaced; expiration does not automatically start Studio.

Manual mode switching is refused while a lease is active. The three-agent extension acquires a lease for the whole workflow, renews it every 100 seconds, aborts if renewal fails, and releases it on completion, block, cancellation, or shutdown. Interactive managed-model turns receive shorter per-turn leases.

## Transport

`~/.config/pi-inference/client.json` uses `transport = "auto"`. The shared client intentionally uses JSON and Python 3.9-compatible syntax so it does not depend on Python 3.11's `tomllib`:

1. If `${XDG_RUNTIME_DIR}/pi-inference-manager.sock` exists, use the mode-0600 Unix socket.
2. Otherwise call the HTTPS control endpoint with the control bearer token.

The manager itself binds plain HTTP only to loopback. It refuses a non-loopback `tcp_host`; nginx terminates TLS.

## Remote exposure gate

Remote clients may have dynamic public addresses, so the control endpoint uses two independent factors: a private per-client TLS certificate verified by nginx, and the control bearer token verified by the manager. `pi-inference-host/.config/nginx/pi-inference-control.conf` is a template, not an automatically installed site. Before copying it into `/etc/nginx/sites-enabled/`:

1. Ensure `inference.malo.tn.it` resolves to the GPU host for intended clients.
2. Create an offline/private client CA and an initial CRL; never commit the CA private key.
3. Issue a unique client certificate and private key for each authorized machine.
4. Install only the public CA certificate and CRL under `/etc/nginx/pi-inference/`.
5. Install each client identity under its non-stowed `~/.pi-inference/credentials/` directory with the private key mode `0600`.
6. Validate with `sudo nginx -t`, then test that requests without a client certificate fail during TLS authentication.
7. Reload nginx and test mTLS plus bearer authentication from each remote client.

Revoking one machine means revoking its unique certificate, regenerating `control-client-ca.crl`, installing that public CRL on the GPU host, and reloading nginx. Regenerate and reinstall the CRL before its `nextUpdate` even when no certificate was revoked; the current PKI policy uses a one-year CRL lifetime. The model API and control API use separate hostnames and credentials.

## Durable state and restart behavior

Manager state is atomically stored in systemd's private user `StateDirectory` (normally):

```text
~/.local/state/pi-inference-manager/state.json
```

Client-side opaque lease records use `~/.pi-inference/state/client-leases/`, alongside the non-stowed credential area. Neither location belongs to a Stow package.

The raw lease ID is not stored in manager state. On manager restart, an unexpired lease causes team mode to be restored before requests are served. A graceful Pi shutdown explicitly releases its workflow lease. After a hard client crash, the random fenced owner is deliberately not adopted by a new process; recovery waits for the bounded TTL (normally at most five minutes) before another client may acquire the GPU. This host-global lease complements, rather than replaces, repository task authorization and durable queue state.

## Staged migration from the legacy local script

The legacy `~/.local/bin/pi-inference` is a real file at the exact Stow destination. Stow must never be asked to adopt or overwrite it implicitly. Keep the active three-agent configuration on its legacy lifecycle until this sequence passes:

1. Preview both packages from the dotfiles checkout:

   ```bash
   stow --simulate --verbose=2 --target "$HOME" pi pi-inference-host
   ```

2. Provision the new model credential from an already accepted router key without printing it:

   ```bash
   awk 'NF && $1 !~ /^#/ {print; exit}' ~/.local/share/pi-llama-router/api-keys \
     | /path/to/new/pi-inference credential --install model-api
   ```

3. Generate and install a distinct control credential through the same stdin-based installer.
4. Move—not delete—the legacy script to a timestamped backup after reviewing its contents:

   ```bash
   mv ~/.local/bin/pi-inference ~/.local/bin/pi-inference.legacy-YYYYMMDD-HHMMSS
   ```

5. Stow `pi` and `pi-inference-host`, start the manager, and test `pi-inference status` through the Unix socket.
6. Test acquire, renew, conflict, release, Studio mode, and return to team mode locally.
7. Only then activate the lease lifecycle fields and the new model credential command in `~/.config/pi-three-agent-team/config.json`.
8. Enable remote HTTPS as a separate gate only after client-certificate issuance, revocation-list installation, and nginx validation.

Rollback stops the manager, unstows only the new package links, restores the timestamped legacy script, and restores the previous team configuration. No credential or evidence directory is deleted during rollback.
