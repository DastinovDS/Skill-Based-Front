# Legal minimum (LEG-01, #87)

This is not legal advice. The texts at `/impressum` and `/privacy` (English only since 2026-10-23) are assembled from the actual
behavior of the code and contain placeholders. **A lawyer must review them before the site is published**, and the owner
must fill in the real operator data.

## What is done in the code

- The pages `/impressum` and `/privacy`: `apps/client/src/legal/LegalPage.svelte`, the text in
  `apps/client/src/i18n/legal/en.ts` (English only since #387; one content file per language if more are added) (Caddy serves `index.html` for any unknown path).
- Footer links on every screen (including the welcome screen and the match): `LegalFooter.svelte`,
  mounted in `main.ts`. The links open in a new tab so as not to interrupt a match.
- While a placeholder like `<OPERATOR_NAME>` remains in the text, the page shows a "Draft" note.
  When all placeholders are replaced, the note disappears by itself.
- Container logs: `compose.yaml`, the `json-file` driver, rotation by size (`max-size: 10m`,
  `max-file: 3`), the records are removed together with the container on deploy.

## What data the application processes (checked against the code)

| Data | Where | Retention |
|---|---|---|
| nick, `created_at`, SHA-256 of the token, the end of a queue ban for repeated resigns `queue_banned_until` (`players`, `identity.py`, DEC-34) | DB `/data/gow.db` | until deletion on request |
| the password hash, if the player set one: `scrypt$n$r$p$salt$hash` (`players.password_hash`, `passwords.py`, #374); the password itself is not stored, not logged and not returned in 422 errors; there is no password recovery | DB | until deletion on request or a reset (`gow-admin reset-password`) |
| token, nick and whether the account has a password | `localStorage["sbf.guest"]` in the browser (`guestStore.ts`); removed by "Log out" | until the player logs out or clears it |
| number of matches played and the last match id (hides the key hints after the third match) | `localStorage["sbf.hints.matches"]`, `["sbf.hints.last"]` (`hud/hints.ts`) | until the player clears it |
| interface language | `localStorage["sbf.locale"]` (`locale.ts`); written only when the viewer picks a language, and the selector is hidden while only `en` exists (#387), so currently not written | the same |
| rating, matches, sides (`ratings`, `matches`, `match_players`) | DB | until deletion on request |
| replays (`*.jsonl.gz`, `*.frames.json.gz`) | `/data/replays` and the backup mirror `$BACKUP_DIR/replays`, contain no nick | at most the last 5 finished matches per account (`GOW_REPLAY_KEEP_PER_PLAYER`): a replay is deleted when its match is no longer among the last 5 of any of its human players, rated or not; optional extra limits in days `GOW_REPLAY_RETENTION_DAYS`, `GOW_REPLAY_RATED_RETENTION_DAYS` (off by default); the mirror follows within one backup (#525, SRV-08, #515) |
| archive of command logs for game statistics (`*.jsonl.gz` only, no frames file): copied before a replay is deleted, only when the operator sets `GOW_REPLAY_STATS_ARCHIVE_DIR` (off by default; meant for development and playtests, `docs/ops/deploy.md`, section 4); contain no nick, tied to a player only by the match id and the match sides in the database; not served to players, not part of backups | the separate volume `gow-replay-stats` mounted at `/replay-stats` (or the directory the operator names) | until the operator deletes it: <ARCHIVE_RETENTION_PERIOD, to be set by the operator> |
| game statistics from the match command log (stance, command rate, supply actions, the share of scheduled orders, CP spending): `gow-bots analyze` and `gow-bots stats` compute them offline from a replay; not stored anywhere; tied to a player only by the match side (`match_players`), for balance and match review (#375) | the command output, not stored in the DB or on the server | as for replays |
| IP when a guest is created | process memory, `SlidingWindowLimiter` (window `GOW_GUEST_RATE_WINDOW_S`, 1 h) | until the window ends or a restart |
| IP and `nick_key` of password login attempts (`abuse.Limits.login_ip`, `login_nick`, `login_nick_total`) | process memory (windows `GOW_LOGIN_IP_RATE_WINDOW_S`, `GOW_LOGIN_NICK_RATE_WINDOW_S`, 10 min) | until the window ends or a restart |
| server log (`app.py`, `logs.py`) | the container stderr: method, path without query, status, time, request id; without IPs and tokens | rotation |
| Caddy log | the access log is not configured (`deploy/Caddyfile` has no `log`); the service log may contain IPs in errors | rotation |

There are no cookies, analytics, third-party services or error collection; the CSP `default-src 'self'` forbids external requests.

## Deleting a guest on request

The `players` row cannot be physically deleted (a foreign key from `match_players`, and `player_id` cannot be NULL),
so the guest is anonymized: the nick and the token hash are replaced, the password hash and the rating are deleted. The matches stay without a link to the person.
Make a backup before the edit: `deploy/backup.sh before-delete`.

```bash
docker compose exec app python - <<'PY'
import os, sqlite3, sys
from gow_server.nicks import skeleton
nick = "<NICK>"  # the nick from the request
db = sqlite3.connect("/data/gow.db")
row = db.execute("SELECT id FROM players WHERE nick_key = ?", (skeleton(nick),)).fetchone()
if row is None:
    sys.exit("no such nick")
with db:
    db.execute(
        "UPDATE players SET nick = ?, nick_key = ?, token_hash = ?, password_hash = NULL"
        " WHERE id = ?",
        (f"deleted-{row[0]}", f"deleted-{row[0]}", os.urandom(32), row[0]),
    )
    db.execute("DELETE FROM ratings WHERE player_id = ?", (row[0],))
print("anonymized player", row[0])
PY
```

Confirming ownership of a nick (the account has no e-mail): by agreement, for example a match at an agreed time.

## MANUAL: what remains for a human

- Fill in the operator data in `apps/client/src/i18n/legal/en.ts`: `<OPERATOR_NAME>`, `<STREET_AND_NUMBER>`,
  `<POSTAL_CODE_AND_CITY>`, `<COUNTRY>`, `<EMAIL>`, `<PHONE>`, `<VAT_ID_OR_REMOVE_THIS_SECTION>`,
  `<HOSTING_PROVIDER>`, `<HOSTING_LOCATION>`, `<CONFIRM_DPA>`, `<SUPERVISORY_AUTHORITY>`, `<DATE>`.
- Confirm `<LOG_RETENTION_DAYS>` against the real log volume on the VPS (rotation goes by size, not by time)
  or introduce a time limit (for example, `journald` or a daily `docker compose restart`/recreation).
- Legal review of the texts (the Impressum under § 5 DDG, the policy under GDPR, an assessment of storing in `localStorage` without
  a consent banner); if needed add a German text: add `de` to `LOCALES`, a dictionary and
  `i18n/legal/de.ts`.
- MANUAL (#387): the privacy policy and the Impressum exist in English only now (the Russian texts were removed).
  The lawyer decides whether an English-only privacy policy and Impressum are sufficient for an operator in Germany,
  or whether a German text (`de`, see above) is required. The policy still names the `sbf.locale` key in the table of
  what the browser stores; with a single language the client no longer writes it (it only reads and ignores an old
  value), so the lawyer may drop that row.
- Conclude a data processing agreement with the hosting provider (AVV/DPA).
- MANUAL (#375): the lawyer reviews the paragraph about game statistics in the section "Matches, rating and replays" of the policy
  (only the English text now) and the table row above: the legal basis (balance and match review, Art. 6(1)(f) GDPR),
  the retention "as for replays", whether a separate mention in "Your rights" is needed.
- MANUAL (#525): the lawyer reviews the wording on replay storage (5 per account) and on the optional archive of command logs for game statistics during development and playtests (legal basis, the retention `<ARCHIVE_RETENTION_PERIOD>`, deletion on request: the archive is keyed by match id, so a player's logs are found through `match_players`), and whether the policy text must name the archive while it is switched off.
