# VPS deployment, deploys, backups (OPS-03, #82)

Placeholders: `<VPS_HOST>` (the server IP or name), `<DOMAIN>` (the game domain), `<REPO_URL>` (the repository URL
for `git clone`). There are no real values in the repository.

What was checked locally (`HTTP_PORT=8080 HTTPS_PORT=8443 deploy/deploy-test.sh`, also in the CI job `docker`):
a deploy, a rollback of a broken release with the data kept, a backup of a running server and a restore into a clean volume.
What needs a real server is marked **[manual]**.

## 1. Preparing the VPS [manual]

Hetzner Cloud, Debian 13 or Ubuntu 24.04, from 2 GB RAM (building the client image). Right at creation
add an SSH key and a Hetzner Cloud Firewall: incoming only 22/tcp, 80/tcp, 443/tcp, 443/udp.

```sh
ssh root@<VPS_HOST>
apt-get update && apt-get -y upgrade
apt-get -y install ca-certificates curl git ufw unattended-upgrades rsync
# Docker Engine and Compose v2 from the official repository: https://docs.docker.com/engine/install/debian/
# (for Ubuntu: .../install/ubuntu/), packages docker-ce docker-compose-plugin docker-buildx-plugin.

# A non-root user. The docker group is equal to root in rights: on a server with a single service this is a
# deliberate compromise; the alternative: rootless Docker.
adduser --disabled-password --gecos "" gow
usermod -aG docker gow
install -d -m 700 -o gow -g gow /home/gow/.ssh
install -m 600 -o gow -g gow /root/.ssh/authorized_keys /home/gow/.ssh/authorized_keys
install -d -m 700 -o gow -g gow /var/backups/skill-based-front

# Container log rotation, otherwise they fill the disk.
printf '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }\n' \
  > /etc/docker/daemon.json && systemctl restart docker

# Firewall. Docker publishes ports bypassing ufw, but only Caddy's 80/443 are published outward.
ufw default deny incoming && ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp \
  && ufw allow 443/udp && ufw --force enable

# SSH: keys only, no root. First check the login `ssh gow@<VPS_HOST>` from a second terminal.
printf 'PermitRootLogin no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\n' \
  > /etc/ssh/sshd_config.d/10-hardening.conf && sshd -t && systemctl reload ssh

dpkg-reconfigure -f noninteractive unattended-upgrades
```

Hardening checklist: [ ] SSH login only by key and not as root; [ ] ufw and the Cloud Firewall let through only
22, 80, 443; [ ] `docker compose ps`: only `caddy` publishes a port outward; [ ] automatic security updates
are enabled; [ ] `.env` has mode 600 and is not in git; [ ] backups are copied off the server (section 4).

## 2. The first deploy [manual]

DNS: the A record `<DOMAIN>` points to `<VPS_HOST>`, before Caddy starts (otherwise ACME will not issue a certificate).
No AAAA record (owner's decision of 2026-10-28): the production domain is IPv4 only until the per-IP limits key IPv6 clients by their /64 (audit SRV-05, #415); otherwise a client with an IPv6 /64 gets a new address, and a new limit, for every request.

```sh
ssh gow@<VPS_HOST>
git clone <REPO_URL> ~/skill-based-front && cd ~/skill-based-front   # private repository: a read-only deploy key
cp .env.example .env && chmod 600 .env
# In .env: SITE_ADDRESS=<DOMAIN>, DEPLOY_BASE_URL=https://<DOMAIN>, BACKUP_DIR=/var/backups/skill-based-front
deploy/deploy.sh origin/main
BASE_URL=https://<DOMAIN> deploy/check-caddy.sh   # needs Node to compare the CSP; can be run from a laptop
sudo cp deploy/systemd/gow-backup.* /etc/systemd/system/ && sudo systemctl enable --now gow-backup.timer
```

Secrets and settings live only in `~/skill-based-front/.env` on the server (`.gitignore` excludes `.env*`,
`.dockerignore` keeps them out of the image). There are no secrets now: guest tokens are created by the server, certificates by Caddy.

## 3. A regular deploy and rollback

```sh
ssh gow@<VPS_HOST> 'cd ~/skill-based-front && deploy/deploy.sh origin/main'   # or a release tag
```

`deploy/deploy.sh [ref]`: a clean working copy → `git checkout --detach ref` → the current images are tagged
`:previous` → build → draining matches → the `predeploy` backup → `docker compose up --wait` (container healthchecks) and
`GET $DEPLOY_BASE_URL/api/health`. If the new version did not come up: a return to the previous commit and images,
a restore of the `predeploy` backup (the new version could have applied a migration), a start, exit with code 1.
Data changes made during the failed start are lost.

Draining matches (SRV-02, #47): after the build and before the backup `deploy.sh` asks the running server not to start
new matches (`POST /internal/drain` from inside the `app` container, the endpoint answers only on loopback and without proxy headers (#194),
Caddy does not proxy it) and waits until the number of active matches becomes 0, for no longer than
`DEPLOY_DRAIN_TIMEOUT` seconds (1200 by default: a 15-minute match, DEC-22, plus a reserve). On timeout the deploy
goes on, and the remaining matches are cut off by the switch. If the deploy stopped before the switch
(for example, the backup failed), draining is cancelled (`DELETE /internal/drain`). A server older than #47 has no
such endpoint: then a warning, and the deploy goes on without draining. The state by hand:
`docker compose exec app python -c "import urllib.request as u; print(u.urlopen('http://127.0.0.1:8000/internal/drain').read())"`.

A manual rollback to a specific version: `deploy/deploy.sh <previous-tag>`; if the DB schema is newer than the code,
then `deploy/restore.sh <the predeploy backup of this deploy>`.

## 4. Backups

- `deploy/backup.sh [label]` writes `$BACKUP_DIR/gow-<UTC time>-<label>.tar.gz`: `gow.db` (a `VACUUM INTO`
  snapshot, safe with a running server and WAL; `PRAGMA integrity_check` before packing) and
  `replays/`. The last `BACKUP_KEEP` (14 by default) archives of each label are kept.
- The nightly backup: `deploy/systemd/gow-backup.timer` (03:30 UTC, label `nightly`). Check:
  `systemctl list-timers gow-backup.timer`, `journalctl -u gow-backup`.
- **[manual] A copy off the server.** A backup on the same disk does not protect against losing the VPS. For example, a Hetzner
  Storage Box (`<STORAGE_BOX_USER>@<STORAGE_BOX_HOST>`, the SSH key of the user `gow`): add to
  `gow-backup.service` the line
  `ExecStartPost=/usr/bin/rsync -a /var/backups/skill-based-front/ <STORAGE_BOX_USER>@<STORAGE_BOX_HOST>:skill-based-front/`
  and watch the space on the storage side.

## 5. Restore

```sh
deploy/restore.sh /var/backups/skill-based-front/gow-<...>.tar.gz
```

The script stops `app`, checks the archive (`integrity_check`, applied migrations), replaces the database
(together with `-wal`/`-shm`) and the replays, starts the stack. On a clean machine: sections 1 and 2 without `deploy.sh`,
copy the archive (`scp`), `docker compose build`, then `deploy/restore.sh <archive>`.

**[manual] A check on a clean machine** (once before a release and once a quarter): a new VPS or a local
machine, restore the latest `nightly`, open the game, make sure a known guest is there
(`GET /api/me` with their token). Locally the same is done by step 3 of `deploy/deploy-test.sh` (the compose project
`gow-restore-test` with a new volume).

## 6. What remains to be done by hand

- [ ] The VPS, the DNS for `<DOMAIN>`, the Cloud Firewall, the steps of section 1.
- [ ] The first deploy, the Let's Encrypt certificate (Caddy gets it itself), `check-caddy.sh` against `https://<DOMAIN>`.
- [ ] The nightly backup timer and the copy off the server.
- [ ] A restore on a clean machine from a real nightly backup.
- [ ] An external availability check of `https://<DOMAIN>/api/health` (section 7).
- [ ] A webhook for alerts, `ALERT_WEBHOOK_URL` in `.env`, the service `gow-alerts` (section 7).
- [ ] The owner's decision: collecting errors with an external service (Sentry and the like), section 7.

## 7. Observability (OPS-04, #83)

### Logs

The server writes JSON lines to the stderr of the `app` container (the fields `ts`, `level`, `logger`, `msg`, `request_id`, the event fields).
The request log has no query string, tokens and invite codes do not get into the logs (tests in `apps/server/tests`).
To view: `docker compose logs -f app`; a whole match: `docker compose logs app | grep '"match_id": "<id>"'`.
Docker log rotation is enabled by section 1. An exception in a match is written with a traceback and `match_id`
(`"msg": "match crashed"`), the other matches go on; exceptions of HTTP handlers are written by uvicorn (`uvicorn.error`) in the same JSON.

### Metrics

`GET /internal/metrics` (the Prometheus format). The endpoint answers only on loopback, like `/internal/drain`; Caddy proxies
only `/api/*` and `/ws/*`, and `deploy/check-caddy.sh` checks that the metrics are unreachable from outside. There are no new dependencies
(`apps/server/src/gow_server/metrics.py`). To take them by hand:

```sh
docker compose exec app python -c "import urllib.request as u; print(u.urlopen('http://127.0.0.1:8000/internal/metrics').read().decode())"
```

| Metric | What it is |
|---|---|
| `gow_matches_active` | matches running now |
| `gow_matches_started_total`, `_finished_total`, `_crashed_total` | match counters |
| `gow_tick_lag_seconds` (histogram) | how much later than scheduled a tick started; the alert threshold is 10% of the tick period = 10 ms at 10 Hz |
| `gow_step_seconds` (histogram) | the duration of one tick; p99: `histogram_quantile(0.99, rate(gow_step_seconds_bucket[5m]))` |
| `gow_bot_overruns_total`, `gow_bot_skipped_total` | bot decisions longer than the budget and the calls skipped because of them (per match the same is written to the `match finished` log) |
| `gow_ws_connections` | open match WebSocket connections |
| `gow_outbox_backlog_max` | the longest unsent queue of a connection (the client is not reading) |
| `gow_queue_size` | players in the matchmaking queue: looking for an opponent or confirming a found pair (MM-01) |

Prometheus cannot reach inside the container (the endpoint is loopback). To collect, a small collector inside the container is needed next to the application, or
a one-off poll by `cron`; for now manual collection and the logs are enough. [owner's decision]

### Alerts

The server writes an alert as an ERROR line of the logger `gow_server.alerts` with the field `alert`:

- `match_crashed`: a match crashed with an exception (next to it a `match crashed` record with a traceback and the same `match_id`);
- `tick_lag`: the average tick lag of a match over the window `GOW_MONITOR_INTERVAL_S` is more than 10% of the tick period or the loop reset the schedule.

The same alert for one match no more often than once in 5 minutes. The `app` container has no way out (the `internal` network),
so the alerts are delivered by the host-side `deploy/alert-forward.sh`: it reads the container log and sends every alert line by POST
(`application/json`, body: the log record) to `ALERT_WEBHOOK_URL`. The webhook address is secret (in `.env`, passed to curl through stdin).

```sh
echo 'ALERT_WEBHOOK_URL=https://<WEBHOOK_HOST>/<TOKEN>' >> .env
sudo cp deploy/systemd/gow-alerts.service /etc/systemd/system/ && sudo systemctl enable --now gow-alerts
```

A check without a server: `echo '{"alert": "test", "msg": "probe"}' | deploy/alert-forward.sh -`.
The body format: for Slack/Telegram and the like a small adapter on the receiver side is needed (ntfy, n8n, Pipedream).

### Errors and external services [owner's decision]

Error collection is done from the logs (above). An external SaaS (Sentry, GlitchTip, Bugsnag) is not connected without the owner's decision:
it would receive player data and requires a dependency in the server and the client (`@sentry/browser` also weakens the CSP: `connect-src`).
Self-hosted GlitchTip is compatible with the Sentry SDK. Client errors are visible only in the browser console for now.

### External availability check [manual]

It is needed from outside the VPS (otherwise the failure of the VPS itself goes unnoticed): UptimeRobot, Better Stack or Healthchecks.io against
`https://<DOMAIN>/api/health` (expect 200 and `{"status":"ok"}`), an interval of 1 minute, a notification to the owner.

## 8. Abuse protection and moderation (MOD-01, #79)

### Limits

All limits live in the memory of one process (a server restart zeroes the counters) and are configured through `GOW_*`
(`.env`, `compose.yaml`, the table in the README). Exceeding: HTTP 429 with the `Retry-After` header.

| What | Key | Default | Where |
|---|---|---|---|
| Creating guests | client IP | 10 per hour | `POST /api/guest` (ID-01) |
| Creating matches (invites and bot matches together) | player | 10 per 10 minutes | `POST /api/matches`, `POST /api/bot-matches` |
| Changing the nick | player | 3 per day | `PUT /api/me/nick` |
| Login by nick and password | client IP | 20 per 10 minutes | `POST /api/login` (#374) |
| Login by nick and password | `nick_key` | 10 per 10 minutes | `POST /api/login`: guessing the password of one account from different IPs |
| Setting and changing the password | player | 5 per hour | `POST /api/account/password` |
| Joining the matchmaking queue | player | 20 per minute | `POST /api/queue` (MM-01) |
| Commands in a match | connection | 20/s, burst 60 | WebSocket, flooding leads to a disconnect (SRV-03) |
| Active match | player | 1 | `409` (SRV-09) |
| Repeated resigns in rated matches | player | 2nd in 24 hours: 5 minutes out of the queue; 3rd: 30 minutes; 4th and later: 2 hours (the 1st: none) | `POST /api/queue`: `429` with `Retry-After` and a `QueueBan` body (DEC-34, #414; `GOW_RESIGN_*`) |
| Rated matches between the same two accounts | pair of accounts | 3 per 24 hours, then unrated | the matchmaking queue still pairs them, the match is unrated (DEC-34; `GOW_OPPONENT_LIMIT*`) |
| HTTP request body | request | 32 KiB (`GOW_MAX_REQUEST_BODY_BYTES`) | `413` before any parsing, in the server (by `Content-Length` and by counting a streamed body) and, at 64 KB, in Caddy on `/api/*` (SRV-01, #411) |

**The per-IP limit works only with the real client address.** The server takes the address from `request.client`, and uvicorn
puts `X-Forwarded-For` there only from trusted proxies (`GOW_FORWARDED_ALLOW_IPS`). In `compose.yaml`
it is set to `*`: the `app` container is reachable only from the internal network, that is only by Caddy, and Caddy replaces the
`X-Forwarded-For` sent by the client with the real address. If you run the server without Caddy on a public port, keep the
default `127.0.0.1`: otherwise a client will forge the address and bypass the limit. If there is one more proxy behind Caddy
(Cloudflare and the like), `trusted_proxies` must be configured in Caddy, otherwise the limit will see the address of that
proxy and count all players as one client.

### Nicks

The rules (`gow_server/nicks.py`, the rationale is in the module docstring):

- format: 3 to 16 characters, letters of one script (a mix of Latin and Cyrillic in one nick is forbidden), digits, `_`, `-`;
- uniqueness by "skeleton": case, diacritics, `_`/`-` and look-alike letters do not make a nick new
  (`Cap` and the Cyrillic `Сар`, `Ilya` and `llya`, `Pro100` and `Pr0lOO` are counted as one nick). The look-alike table is
  manual and covers Cyrillic and Greek against Latin, it is not the full Unicode TR39 `confusables.txt`;
- reserved nicks (`admin`, `moderator`, `support`, `админ`, ... with digits at the end) and forbidden words
  (a short built-in list, compared by skeleton, so `sh1t` and `f_u_c_k` are cut off too). The list
  looks for substrings, so a harmless nick sometimes falls under the ban: then rename the player with `gow-admin rename`.
  Your own words: the file `GOW_NICK_BLOCKLIST_FILE` (one word per line, for example `/data/nick-blocklist.txt` on the volume).

Migration `0004` recomputes the `nick_key` of existing players by the new rule; if two nicks now coincide,
the key of the later one gets the suffix `#<id>`, and it is worth renaming.

### The admin script `gow-admin`

```sh
docker compose exec app gow-admin show <player>            # id or nick
docker compose exec app gow-admin rename <player> <nick>
docker compose exec app gow-admin block <player>
docker compose exec app gow-admin unblock <player>
docker compose exec app gow-admin reset-password <player>   # the new password is entered twice, no echo
```

A blocked account gets 403 on every HTTP request and a refusal at the next connection to a match WebSocket;
a match already in progress goes on to the end or to a technical defeat by the reconnect timer. `rename` checks the format
and uniqueness, but not the lists of forbidden words (the operator decides). Without Docker: `uv run gow-admin ...` with the same
`GOW_DATABASE_URL`. The script works with the database while the server is running (SQLite WAL).

`reset-password` (#374): players have no password recovery, the reset is done by the operator. The password is not passed as an argument
and is not printed: the script asks for it twice on the terminal (`docker compose exec` gives a terminal). The old token
stops working on all devices; the player logs in with the nick and the new password that the operator passed to them
(by agreement, as with deletion on request, `docs/ops/legal.md`). The password: 10..128 characters after NFKC.
The scrypt parameters of new hashes: `GOW_SCRYPT_N` (2^15), `GOW_SCRYPT_R` (8), `GOW_SCRYPT_P` (1), `GOW_SCRYPT_MAXMEM`
(64 MB); a hash stores its own parameters, so they can be raised without resetting passwords. `[manual]` Measure the hash time
on the VPS (a target of 50..100 ms) and change `GOW_SCRYPT_N` if needed. The login limits: the table above.
At most `GOW_SCRYPT_CONCURRENCY` (3) scrypt runs go at once (each about 32 MiB, so about 100 MiB at most): a login or a password
change over that gets `503` with `Retry-After: 1` at once instead of queueing. The hash runs without a database connection
(read, release, hash, write), so a login burst does not starve match inserts and WebSocket token lookups (#413).

### What is not done

Player reports about nicks and logging of blocks are not part of the issue: blocks are visible in the container log only as
403 in requests. `[manual]` The first list of forbidden words was compiled by the author of the code: the owner should review it
and extend it for their audience.
