# Pi inference control plane

## Purpose

The R9700 has one inference owner at a time. Model traffic and lifecycle control use separate endpoints and credentials:

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

The manager grants one renewable host-global lease. This prevents local and remote Pi sessions from switching or using the single GPU concurrently.

Remote control authentication is HTTPS plus a dedicated high-entropy control bearer. The model API uses a different bearer. Never reuse one credential for both roles.

## New remote client: quick setup

A client needs only outbound HTTPS. It does **not** need inbound SSH, a fixed public address, a client certificate, or access to the GPU host.

### 1. Prerequisites

Install:

- Git
- GNU Stow
- Python 3.9 or newer
- Pi and Node when the machine will run Pi

Check connectivity:

```bash
python3 --version
git --version
stow --version
python3 - <<'PY'
import socket
for host in ("inference.malo.tn.it", "llm.malo.tn.it"):
    print(host, socket.gethostbyname(host))
PY
```

### 2. Get the shared configuration

Clone the dotfiles repository when absent:

```bash
git clone https://github.com/malodev/dotfiles.git ~/dotfiles
```

For an existing checkout, inspect it before updating:

```bash
git -C ~/dotfiles status --short --branch
```

Never reset or stash unrelated changes as part of client setup. Once reviewed:

```bash
git -C ~/dotfiles pull --ff-only origin main
```

### 3. Preview setup

```bash
cd ~/dotfiles
./scripts/pi-inference-client-setup
```

The default is a GNU Stow simulation. It does not write configuration or credentials.

### 4. Apply and verify

Have these two **different** values available in a password manager:

1. the **control bearer** for `inference.malo.tn.it`;
2. the separate **model API key** for `llm.malo.tn.it`.

The helper and manager both fail closed if the values are equal. Generate the control bearer with at least 256 bits of entropy (for example, `openssl rand -base64 32`) and capture it directly into a password manager or private file rather than shell history.

For a Pi client, run:

```bash
cd ~/dotfiles
./scripts/pi-inference-client-setup --apply --verify --with-pi
```

The helper prompts privately for each missing credential. Input is not echoed. Credentials are stored outside the dotfiles checkout:

```text
0600 ~/.pi-inference/credentials/control-api-token
0600 ~/.pi-inference/credentials/model-api-key
```

For an API-only client, omit `--with-pi`:

```bash
./scripts/pi-inference-client-setup --apply --verify
```

For non-interactive provisioning, provide private mode-`0600` source files. Their values are read through stdin by the shared credential installer and are never command-line arguments:

```bash
./scripts/pi-inference-client-setup \
  --apply --verify --with-pi \
  --control-token-file /private/path/control-token \
  --model-key-file /private/path/model-key
```

The helper refuses to overwrite existing credentials. Replacement remains a separate explicit operation:

```bash
pi-inference credential --install --replace control-api
pi-inference credential --install --replace model-api
```

### 5. Expected verification

Successful setup reports:

```text
Control authentication: without bearer=401, with bearer=200
Model inference: REMOTE_MODEL_OK
Pi managed-provider lifecycle: REMOTE_PI_OK   # with --with-pi
REMOTE_INFERENCE_CLIENT_VERIFIED
```

A lease conflict means another authorized client currently owns the GPU. Wait for that operation to finish and retry; do not bypass the manager.

## Normal client operation

Pi requires no manual lifecycle commands. The three-agent extension automatically:

1. acquires the global lease before a managed-model turn or workflow;
2. renews long-running workflow leases;
3. blocks provider requests if no healthy lease exists;
4. releases the lease on completion, cancellation, block, or graceful shutdown.

Manual/API-only applications must bracket model calls themselves:

```bash
owner="$(hostname -s):application:operation-id"
pi-inference acquire --mode team --owner "$owner" --ttl 300
# Call https://llm.malo.tn.it/v1 while the lease is healthy.
pi-inference renew --owner "$owner" --ttl 300
pi-inference release --owner "$owner"
```

Use a trap or `finally` block for release. A crashed client remains fenced only until the bounded lease TTL expires.

Useful commands:

```bash
pi-inference status
pi-inference acquire --mode team --owner host:repo:task --ttl 300
pi-inference renew --owner host:repo:task --ttl 300
pi-inference release --owner host:repo:task
```

Manual `team`, `studio`, and `stop` switches are refused while any lease is active.

## Shared and host-only Stow packages

Every client installs only the shared package:

```bash
cd ~/dotfiles
stow --simulate --verbose=2 --target "$HOME" pi
stow --target "$HOME" pi
```

The GPU host additionally installs the manager package:

```bash
cd ~/dotfiles
stow --target "$HOME" pi-inference-host
systemctl --user daemon-reload
systemctl --user enable --now pi-inference-manager.service
```

Never Stow `pi-inference-host` on an ordinary client.

## Credentials and trust boundary

The GPU host stores the same two bearer values under:

```text
~/.pi-inference/credentials/control-api-token
~/.pi-inference/credentials/model-api-key
```

Both files must be mode `0600`; `~/.pi-inference/` must remain outside Git and Stow. Runtime state and lease IDs also remain outside the repository.

The control bearer authorizes privileged lease and service-mode operations. The model key authorizes inference only. Both travel only over certificate-verified HTTPS, and the shared client refuses redirects so a bearer cannot be forwarded to another origin.

Bearer-only authentication has one operational trade-off: all clients provisioned with the shared control bearer must be updated when it is rotated. A compromised client cannot be independently revoked without rotating that bearer. Keep it in a password manager, provision only trusted machines, and rotate it after suspected exposure.

## Transport

`~/.config/pi-inference/client.json` uses `transport = "auto"`:

1. On the GPU host, use `${XDG_RUNTIME_DIR}/pi-inference-manager/control.sock` when present. The socket is mode `0600`.
2. Otherwise use `https://inference.malo.tn.it/v1` with the control bearer.

The manager binds plain HTTP only to loopback. Nginx terminates public TLS. It does not accept control requests without the manager's bearer authentication.

The model data plane remains separate at `https://llm.malo.tn.it/v1`.

## GPU-host nginx deployment

The tracked template is:

```text
pi-inference-host/.config/nginx/pi-inference-control.conf
```

Install and validate it on the GPU host:

```bash
sudo install -m 0644 \
  ~/dotfiles/pi-inference-host/.config/nginx/pi-inference-control.conf \
  /etc/nginx/sites-available/pi-inference-control.conf

available=/etc/nginx/sites-available/pi-inference-control.conf
enabled=/etc/nginx/sites-enabled/pi-inference-control.conf

if sudo test -e "$enabled"; then
  if [ "$(sudo readlink -f "$enabled")" != "$available" ]; then
    echo "STOP: $enabled is not the expected symlink; back it up and reconcile it manually" >&2
    exit 1
  fi
else
  sudo ln -s "$available" "$enabled"
fi

if sudo grep -Eq 'ssl_verify_client|ssl_client_certificate|ssl_crl' "$enabled"; then
  echo "STOP: the enabled vhost still requires client PKI" >&2
  exit 1
fi

sudo nginx -T 2>&1 | grep -F 'server_name inference.malo.tn.it'
sudo nginx -t
sudo systemctl reload nginx
```

The previous private client CA and CRL are no longer consulted by this vhost. They are retained as historical PKI material and must not be deleted implicitly.

Verify remotely:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://inference.malo.tn.it/v1/status
# Expected: 401

pi-inference status
# Expected: authenticated manager JSON
```

## Durable state and restart behavior

Manager state is atomically stored in systemd's private user state directory, normally:

```text
~/.local/state/pi-inference-manager/state.json
```

Client lease records are mode `0600` beneath:

```text
~/.pi-inference/state/client-leases/
```

The manager stores only a SHA-256 hash of each opaque lease ID. On restart, an unexpired lease restores team mode before requests are served. A hard client crash is fenced until TTL expiry; a new process does not adopt an unrelated previous owner.

## Migration and rollback

The initial deployment replaced a legacy host-local `~/.local/bin/pi-inference` script only after moving it to a timestamped backup. Do not delete that backup automatically.

Rollback procedure:

1. stop `pi-inference-manager.service`;
2. restore the previous nginx site and validate with `nginx -t`;
3. unstow only the new package links;
4. restore the timestamped legacy script and prior team configuration;
5. retain credentials, manager state, and audit evidence for manual review.
