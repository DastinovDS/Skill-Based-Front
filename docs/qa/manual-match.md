# The first live match: a manual checklist (QA-01, #68)

A checklist of a live match on a real stack (Caddy with the built client + the server in Docker), without mocks.
The automatable part is repeated by the Playwright E2E (`e2e/`, QA-02 #84, section "E2E" in `README.md`),
the rest is done by a human. The mark `[x]` means "checked", and next to it is written how and when.

Run of 2026-10-07: the stack from `compose.yaml` + `e2e/compose.e2e.yaml` (ruleset `test-short`, the reconnect
window and the pause 10 s each), port 8080; the commands (section 4) additionally on `mvp-0` (15 minutes, DEC-22); two
players: two Playwright contexts and, for the interface, two tabs of the built-in browser on different
origins (`localhost` and `bob.localhost`: different origins have a separate `localStorage`, that is a separate
guest). Result: 4 bugs were found and filed (section 9), one of them (#183, a white screen of the prod build)
was fixed in the same PR; what remains: a run on two different computers (section 8) and a siege.

## 0. Preparing the test bed

```sh
# Ports 80/443 are taken by another stack: 8080/8443. SITE_ADDRESS=:80 lets any Host in (needed for
# the second "computer" by another name or address); by default Caddy answers only on localhost.
export HTTP_PORT=8080 HTTPS_PORT=8443 SITE_ADDRESS=:80
docker compose -f compose.yaml -f e2e/compose.e2e.yaml up --build -d --wait
curl -s localhost:8080/api/health          # {"status":"ok"}
```

- `e2e/compose.e2e.yaml`: `GOW_ENV=e2e`, ruleset `test-short` (a 60-second match), the reconnect window
  and the pause 10 seconds each. To run the production ruleset (section 4) add a third file with
  `GOW_RULESET_PATH: /app/rulesets/mvp-1.toml` in `services.app.environment`.
- The second player: another browser, a private window or another origin (`http://bob.localhost:8080`). Two tabs
  of one origin share the guest in `localStorage` (`sbf.guest`), it is one and the same player.
- Stop: `docker compose -f compose.yaml -f e2e/compose.e2e.yaml down` (the data stays in the volumes).

## 1. Pages, language, legal part

- [x] The prod build draws the nick form, there are no errors in the console. Found: a white screen (#183), fixed in this PR; now E2E checks it.
- [x] Language selector: removed in #387 (English only). A Russian browser or a saved `sbf.locale=ru` gives the English interface, no selector shown. Checked by Vitest and E2E (`bot-and-pages.spec.ts`).
- [x] `/impressum` and `/privacy` open, the footer links lead to a new tab (the match is not interrupted), "Back to the game" returns to the form. The placeholders `<OPERATOR_NAME>` and the like stay until LEG-01 (#87, the operator's data by hand).
- [x] Guest: a nick of 3 to 16 characters, a repeated nick gives "the nick is taken" (checked on parallel runs), the guest survives a reload.

## 2. A private match by invite

- [x] The host: "Private match with a friend", map choice, the link `/?m=<code>`, the waiting screen.
- [x] The second player opens the link: the form "You were invited to a match", enters a nick, sees the room, the opponent's name at both.
- [x] "Ready" at both: the match starts at both, the map and the HUD are drawn, the tick grows.
- [x] The server assigns the sides (one side to player 0, the other to player 1), each sees only their own half and the limits of the fog.
- [x] An invite taken by a third player gives a refusal (`test_third_player_is_refused` in `apps/server/tests/test_invites.py`).
- [ ] An expired invite (30 minutes): `test_invite_expires_after_30_minutes`; not run by hand (too long). "Leave" from the room was not run by hand.

## 3. A game against a bot

- [x] All four levels (easy, normal, hard, expert) start a match, the tick grows, "Forfeit and leave" gives "Defeat".
- [x] The expert bot against an idle player (60 seconds, `test-short`): the bot captures cities (`node_captured`), the bot wins on the timer (VP 197 against 96). There was no capital capture in 60 seconds.
- [x] One active match per player: while a match is running, a new game answers 409 "the match is already running" (SRV-09).

## 4. Commands

All nine client commands, through the interface, the `ack` answer is looked at in the socket log.

- [x] Move (a click on an own group, then on a node): the path in `ack`, a ghost on the map. E2E and by hand.
- [x] A scheduled order (the "Planned order" tick), more expensive, visible as an intent. E2E and by hand (`mvp-0`).
- [x] Cancelling an order (`orders.cancel`): accepted while the order has not yet set out; after it set out the server answers `NOTHING_TO_CANCEL`, the interface shows "Rejected (cancel order)".
- [x] Splitting a group, merging groups, recruiting in the capital, changing the mode (Attack, Defense; "Build" was removed by DEC-16), upgrading a road (a click on a road with a group selected at its end): all accepted on `mvp-0`.
- [x] The CP stance (Economy, Balance, War): accepted, the button is pressed. E2E.
- [x] A rejection is shown to the human (not enough CP, the target is in the fog): text from the dictionary, not a code.
- [ ] A fight on a road and in a city, a siege, a capital capture through a human's eyes: a live opponent and time are needed. A city capture by a bot is visible in the events, the fight computation is checked by the simulation scenario tests. **By hand, stays open.**

## 5. The end of a match

- [x] By the timer: both have the result screen (a draw or a victory and a defeat, consistently), the reason "Time is up: victory points decide.", the victory points. E2E (60 seconds on `test-short`).
- [x] A forfeit: the one who forfeited sees "Defeat", the opponent "Victory", the reason "A player gave up.". E2E.
- [x] A technical defeat for a disconnect: a player closed or reloaded the page and did not come back within the reconnect window, the opponent has "Victory", the reason "A player left the match.".
- [ ] A victory by the capital (`capital_captured`): not reproduced by hand (see section 4); the logic is covered by the simulation and server tests. **By hand.**

## 6. Reconnection and pause

- [x] A socket drop (the client was not closed): the client reconnects itself with the same token, a second `welcome` arrives, the match goes on without losing ticks. E2E (`page.routeWebSocket` breaks the connection from outside).
- [x] A pause in a private match: a banner at both, the server stops sending snapshots, "Resume" resumes; a second pause is rejected with "A pause is not possible now.". E2E and by hand.
- [x] The reconnect window: a closed tab and the expired 10 seconds (in prod 60) give a defeat by `disconnect`.
- [x] Returning to a running match after a page reload (#189): the client asks `GET /api/me/active-match` and reconnects with the same token (a second `welcome`); if the match is running, the menu has the button "Return to the match". E2E (`invite-match.spec.ts`).
- [ ] A second tab of the same player (close code 4009, the banner "The match was opened in another tab or on another device."): `test_new_connection_replaces_old` in `apps/server/tests/test_ws.py`, not run by hand in a browser.

## 7. Replay

- [x] On the result screen the button "Watch the replay" opens the match viewer (a check of #170 in full: the match row and the frames file are created for private matches and bot matches too). E2E at both players and by hand.
- [x] Playback: Play, Pause, speeds ×1, ×4, ×16, the slider "Position in the match", the VP score, "Back" to the menu. E2E.
- [x] The replay of a foreign match is not accessible (access only for the players of the match, the error "This replay is available to the players of the match only"): checked by `test_unrated_replay_is_for_the_participants` in `apps/server/tests/test_replays.py`.
- [ ] Right after the end of a match the replay is built for several seconds; under a heavy load of the host the screen "Loading the replay..." hung for longer than 30 seconds. Not a format bug, but the client does not repeat the request. An observation, there is no separate issue (see RISKS in the QA-01 report).
- [x] A replay link in `?replay=<id>` needs the token of a player of the match: it opens from the result screen.

## 8. Two different computers over the internet **[by hand]**

Not done: two people on different machines are needed. The recipe:

1. Bring the stack up on your machine as in section 0 (`SITE_ADDRESS=:80`).
2. Give the second machine access: LAN (`http://<machine IP>:8080`) or a temporary tunnel to 8080
   (Cloudflare Quick Tunnel: `cloudflared tunnel --url http://localhost:8080`; or `ngrok http 8080`).
   The WebSocket `Origin` check takes the value from the `Host` header, with a tunnel it passes.
3. Each machine has its own browser, the host creates a match, the second opens the invite link. Go through sections
   2, 4 (at least movement and a fight), 5, 6 (a Wi-Fi drop for a few seconds) and 7.
4. Write down in the table below: the browsers and OS, the latency (RTT in the HUD, if any), smoothness, bugs.

| Date | Machine A (OS, browser) | Machine B (OS, browser) | Channel | Result |
|---|---|---|---|---|
| awaiting a run | | | | |

## 9. Bugs found

| # | What | Severity | State |
|---|---|---|---|
| #183 | The prod build of the client: a white screen (the dev screen pulls fixtures that are not in the Docker context) | P0 | fixed in the QA-01 PR |
| #189 | A page reload in a match does not return to the match, a defeat on the reconnect timeout | P1 | fixed |
| #184 | The HUD event feed shows raw `charges_produced`, `cp_burned`, `attrition` | P2 | fixed |
| #185 | The legal footer covers the score on the replay panel | P2 | fixed |

The acceptance criterion "all items passed": the items with `[ ]` above (a siege and a victory by the capital by hand,
two computers, the reload #189, a second tab, the invite expiry) are not passed, so the issue #68
stays open until the owner does the manual part.
