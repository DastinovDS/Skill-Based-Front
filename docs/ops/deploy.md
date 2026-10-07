# Развёртывание на VPS, деплой, бэкапы (OPS-03, #82)

Плейсхолдеры: `<VPS_HOST>` (IP или имя сервера), `<DOMAIN>` (домен игры), `<REPO_URL>` (URL репозитория
для `git clone`). Реальных значений в репозитории нет.

Что проверено локально (`HTTP_PORT=8080 HTTPS_PORT=8443 deploy/deploy-test.sh`, также в CI job `docker`):
деплой, откат сломанного релиза с сохранением данных, бэкап работающего сервера и восстановление в чистый том.
Что требует настоящего сервера, помечено **[вручную]**.

## 1. Подготовка VPS [вручную]

Hetzner Cloud, Debian 13 или Ubuntu 24.04, от 2 ГБ RAM (сборка образа клиента). Сразу при создании
добавьте SSH-ключ и Hetzner Cloud Firewall: входящие только 22/tcp, 80/tcp, 443/tcp, 443/udp.

```sh
ssh root@<VPS_HOST>
apt-get update && apt-get -y upgrade
apt-get -y install ca-certificates curl git ufw unattended-upgrades rsync
# Docker Engine и Compose v2 из официального репозитория: https://docs.docker.com/engine/install/debian/
# (для Ubuntu: .../install/ubuntu/), пакеты docker-ce docker-compose-plugin docker-buildx-plugin.

# Пользователь без root. Группа docker равна root по правам: на сервере с одним сервисом это
# осознанный компромисс; альтернатива: rootless Docker.
adduser --disabled-password --gecos "" gow
usermod -aG docker gow
install -d -m 700 -o gow -g gow /home/gow/.ssh
install -m 600 -o gow -g gow /root/.ssh/authorized_keys /home/gow/.ssh/authorized_keys
install -d -m 700 -o gow -g gow /var/backups/skill-based-front

# Ротация логов контейнеров, иначе они заполнят диск.
printf '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }\n' \
  > /etc/docker/daemon.json && systemctl restart docker

# Файрвол. Docker публикует порты в обход ufw, но наружу опубликованы только 80/443 Caddy.
ufw default deny incoming && ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp \
  && ufw allow 443/udp && ufw --force enable

# SSH: только ключи, без root. Сначала проверьте вход `ssh gow@<VPS_HOST>` из второго терминала.
printf 'PermitRootLogin no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\n' \
  > /etc/ssh/sshd_config.d/10-hardening.conf && sshd -t && systemctl reload ssh

dpkg-reconfigure -f noninteractive unattended-upgrades
```

Чек-лист харденинга: [ ] вход по SSH только ключом и не под root; [ ] ufw и Cloud Firewall пропускают только
22, 80, 443; [ ] `docker compose ps`: порт наружу публикует только `caddy`; [ ] автообновления безопасности
включены; [ ] `.env` с правами 600 и не в git; [ ] бэкапы копируются за пределы сервера (раздел 4).

## 2. Первый деплой [вручную]

DNS: A (и AAAA) запись `<DOMAIN>` указывает на `<VPS_HOST>`, до запуска Caddy (иначе ACME не выдаст сертификат).

```sh
ssh gow@<VPS_HOST>
git clone <REPO_URL> ~/skill-based-front && cd ~/skill-based-front   # приватный репозиторий: deploy key только на чтение
cp .env.example .env && chmod 600 .env
# В .env: SITE_ADDRESS=<DOMAIN>, DEPLOY_BASE_URL=https://<DOMAIN>, BACKUP_DIR=/var/backups/skill-based-front
deploy/deploy.sh origin/main
BASE_URL=https://<DOMAIN> deploy/check-caddy.sh   # нужен Node для сравнения CSP; можно запустить с ноутбука
sudo cp deploy/systemd/gow-backup.* /etc/systemd/system/ && sudo systemctl enable --now gow-backup.timer
```

Секреты и настройки живут только в `~/skill-based-front/.env` на сервере (`.gitignore` исключает `.env*`,
`.dockerignore` не пускает их в образ). Сейчас секретов нет: токены гостей создаёт сервер, сертификаты Caddy.

## 3. Обычный деплой и откат

```sh
ssh gow@<VPS_HOST> 'cd ~/skill-based-front && deploy/deploy.sh origin/main'   # или тег релиза
```

`deploy/deploy.sh [ref]`: чистая рабочая копия → `git checkout --detach ref` → текущие образы помечаются
`:previous` → сборка → осушение матчей → бэкап `predeploy` → `docker compose up --wait` (healthcheck контейнеров) и
`GET $DEPLOY_BASE_URL/api/health`. Если новая версия не поднялась: возврат к прежнему коммиту и образам,
восстановление бэкапа `predeploy` (новая версия могла успеть применить миграцию), запуск, выход с кодом 1.
Изменения данных за время неудачного запуска теряются.

Осушение матчей (SRV-02, #47): после сборки и до бэкапа `deploy.sh` просит работающий сервер не начинать
новых матчей (`POST /internal/drain` изнутри контейнера `app`, эндпоинт отвечает только на loopback и без заголовков прокси (#194),
Caddy его не проксирует) и ждёт, пока число активных матчей не станет 0, не дольше
`DEPLOY_DRAIN_TIMEOUT` секунд (по умолчанию 900: матч 12 минут плюс запас). По таймауту деплой
продолжается, оставшиеся матчи обрываются переключением. Если деплой остановился до переключения
(например, упал бэкап), осушение отменяется (`DELETE /internal/drain`). Сервер старше #47 эндпоинта не
имеет: тогда предупреждение, и деплой идёт без осушения. Состояние вручную:
`docker compose exec app python -c "import urllib.request as u; print(u.urlopen('http://127.0.0.1:8000/internal/drain').read())"`.

Ручной откат на конкретную версию: `deploy/deploy.sh <предыдущий-тег>`; если схема БД новее кода,
затем `deploy/restore.sh <бэкап predeploy этого деплоя>`.

## 4. Бэкапы

- `deploy/backup.sh [label]` пишет `$BACKUP_DIR/gow-<UTC время>-<label>.tar.gz`: `gow.db` (снимок
  `VACUUM INTO`, безопасно при работающем сервере и WAL; перед упаковкой `PRAGMA integrity_check`) и
  `replays/`. Хранятся `BACKUP_KEEP` (по умолчанию 14) последних архивов каждой метки.
- Ночной бэкап: `deploy/systemd/gow-backup.timer` (03:30 UTC, метка `nightly`). Проверка:
  `systemctl list-timers gow-backup.timer`, `journalctl -u gow-backup`.
- **[вручную] Копия вне сервера.** Бэкап на том же диске не спасает от потери VPS. Например, Hetzner
  Storage Box (`<STORAGE_BOX_USER>@<STORAGE_BOX_HOST>`, SSH-ключ пользователя `gow`): добавить в
  `gow-backup.service` строку
  `ExecStartPost=/usr/bin/rsync -a /var/backups/skill-based-front/ <STORAGE_BOX_USER>@<STORAGE_BOX_HOST>:skill-based-front/`
  и следить за местом на стороне хранилища.

## 5. Восстановление

```sh
deploy/restore.sh /var/backups/skill-based-front/gow-<...>.tar.gz
```

Скрипт останавливает `app`, проверяет архив (`integrity_check`, применённые миграции), заменяет базу
(вместе с `-wal`/`-shm`) и реплеи, запускает стек. На чистой машине: разделы 1 и 2 без `deploy.sh`,
скопировать архив (`scp`), `docker compose build`, затем `deploy/restore.sh <архив>`.

**[вручную] Проверка на чистой машине** (раз перед релизом и раз в квартал): новый VPS или локальная
машина, восстановить последний `nightly`, открыть игру, убедиться, что известный гость есть
(`GET /api/me` с его токеном). Локально то же делает шаг 3 `deploy/deploy-test.sh` (проект compose
`gow-restore-test` с новым томом).

## 6. Что остаётся сделать вручную

- [ ] VPS, DNS `<DOMAIN>`, Cloud Firewall, шаги раздела 1.
- [ ] Первый деплой, сертификат Let's Encrypt (Caddy получает сам), `check-caddy.sh` по `https://<DOMAIN>`.
- [ ] Таймер ночного бэкапа и копия вне сервера.
- [ ] Восстановление на чистой машине из настоящего ночного бэкапа.
- [ ] Внешняя проверка доступности `https://<DOMAIN>/api/health` (раздел 7).
- [ ] Вебхук для алертов, `ALERT_WEBHOOK_URL` в `.env`, служба `gow-alerts` (раздел 7).
- [ ] Решение владельца: сбор ошибок внешним сервисом (Sentry и аналоги), раздел 7.

## 7. Наблюдаемость (OPS-04, #83)

### Логи

Сервер пишет JSON-строки в stderr контейнера `app` (поля `ts`, `level`, `logger`, `msg`, `request_id`, поля события).
Журнал запросов без query string, токены и коды приглашений в логи не попадают (тесты в `apps/server/tests`).
Смотреть: `docker compose logs -f app`; матч целиком: `docker compose logs app | grep '"match_id": "<id>"'`.
Ротацию логов Docker включает раздел 1. Исключение в матче пишется с traceback и `match_id`
(`"msg": "match crashed"`), остальные матчи идут дальше; исключения HTTP-обработчиков пишет uvicorn (`uvicorn.error`) в том же JSON.

### Метрики

`GET /internal/metrics` (формат Prometheus). Эндпоинт отвечает только на loopback, как `/internal/drain`; Caddy проксирует
лишь `/api/*` и `/ws/*`, и `deploy/check-caddy.sh` проверяет, что метрики снаружи недоступны. Новых зависимостей нет
(`apps/server/src/gow_server/metrics.py`). Снять вручную:

```sh
docker compose exec app python -c "import urllib.request as u; print(u.urlopen('http://127.0.0.1:8000/internal/metrics').read().decode())"
```

| Метрика | Что это |
|---|---|
| `gow_matches_active` | матчей идёт сейчас |
| `gow_matches_started_total`, `_finished_total`, `_crashed_total` | счётчики матчей |
| `gow_tick_lag_seconds` (histogram) | насколько позже срока начался тик; порог алерта 10% периода тика = 10 мс при 10 Гц |
| `gow_step_seconds` (histogram) | длительность одного тика; p99: `histogram_quantile(0.99, rate(gow_step_seconds_bucket[5m]))` |
| `gow_bot_overruns_total`, `gow_bot_skipped_total` | решения бота дольше бюджета и пропущенные из-за них вызовы (за матч то же пишется в лог `match finished`) |
| `gow_ws_connections` | открытых WebSocket-соединений матчей |
| `gow_outbox_backlog_max` | самая длинная неотправленная очередь соединения (клиент не читает) |
| `gow_queue_size` | игроков в очереди матчмейкинга: ищут соперника или подтверждают найденную пару (MM-01) |

Prometheus внутрь контейнера не достаёт (эндпоинт loopback). Для сбора рядом с приложением нужен небольшой сборщик в контейнере или
одноразовый опрос по `cron`; пока достаточно ручного снятия и логов. [решение владельца]

### Алерты

Сервер пишет алерт строкой ERROR логгера `gow_server.alerts` с полем `alert`:

- `match_crashed`: матч упал с исключением (рядом запись `match crashed` с traceback и тем же `match_id`);
- `tick_lag`: среднее отставание тиков матча за окно `GOW_MONITOR_INTERVAL_S` больше 10% периода тика или цикл сбросил расписание.

Один и тот же алерт для одного матча не чаще раза в 5 минут. Контейнер `app` не имеет выхода наружу (`internal`-сеть),
поэтому доставляет алерты хостовый `deploy/alert-forward.sh`: читает лог контейнера и шлёт каждую строку алерта POST-ом
(`application/json`, тело: запись лога) на `ALERT_WEBHOOK_URL`. Адрес вебхука секретный (в `.env`, в curl передаётся через stdin).

```sh
echo 'ALERT_WEBHOOK_URL=https://<WEBHOOK_HOST>/<TOKEN>' >> .env
sudo cp deploy/systemd/gow-alerts.service /etc/systemd/system/ && sudo systemctl enable --now gow-alerts
```

Проверка без сервера: `echo '{"alert": "test", "msg": "probe"}' | deploy/alert-forward.sh -`.
Формат тела: для Slack/Telegram и т.п. нужен небольшой переходник на стороне получателя (ntfy, n8n, Pipedream).

### Ошибки и внешние сервисы [решение владельца]

Сбор ошибок сделан по логам (выше). Внешний SaaS (Sentry, GlitchTip, Bugsnag) без решения владельца не подключён:
он получит данные игроков и требует dependency в сервере и клиенте (`@sentry/browser` ещё и ослабляет CSP: `connect-src`).
Самохостинг GlitchTip совместим с Sentry SDK. Ошибки клиента пока видны только в консоли браузера.

### Внешняя проверка доступности [вручную]

Нужна снаружи VPS (иначе падение самого VPS не заметить): UptimeRobot, Better Stack или Healthchecks.io по
`https://<DOMAIN>/api/health` (ожидается 200 и `{"status":"ok"}`), интервал 1 минута, оповещение владельцу.

## 8. Защита от злоупотреблений и модерация (MOD-01, #79)

### Лимиты

Все лимиты в памяти одного процесса (рестарт сервера обнуляет счётчики) и настраиваются через `GOW_*`
(`.env`, `compose.yaml`, таблица в README). Превышение: HTTP 429 с заголовком `Retry-After`.

| Что | Ключ | По умолчанию | Где |
|---|---|---|---|
| Создание гостей | IP клиента | 10 в час | `POST /api/guest` (ID-01) |
| Создание матчей (приглашения и матчи с ботом вместе) | игрок | 10 за 10 минут | `POST /api/matches`, `POST /api/bot-matches` |
| Смена ника | игрок | 3 в сутки | `PUT /api/me/nick` |
| Вход в очередь подбора | игрок | 20 в минуту | `POST /api/queue` (MM-01) |
| Команды в матче | соединение | 20/с, пачка 60 | WebSocket, флуд ведёт к отключению (SRV-03) |
| Активный матч | игрок | 1 | `409` (SRV-09) |

**Лимит по IP работает только при настоящем адресе клиента.** Сервер берёт адрес из `request.client`, а uvicorn
подставляет туда `X-Forwarded-For` только от доверенных прокси (`GOW_FORWARDED_ALLOW_IPS`). В `compose.yaml`
стоит `*`: контейнер `app` доступен лишь из внутренней сети, то есть только Caddy, а Caddy заменяет присланный
клиентом `X-Forwarded-For` настоящим адресом. Если запускать сервер без Caddy на публичном порту, оставьте
значение по умолчанию `127.0.0.1`: иначе клиент подделает адрес и обойдёт лимит. Если за Caddy стоит ещё один
прокси (Cloudflare и подобные), в Caddy нужно настроить `trusted_proxies`, иначе лимит увидит адрес этого
прокси и посчитает всех игроков одним клиентом.

### Ники

Правила (`gow_server/nicks.py`, обоснование в докстринге модуля):

- формат: 3–16 символов, буквы одного письма (смесь латиницы и кириллицы в одном нике запрещена), цифры, `_`, `-`;
- уникальность по «скелету»: регистр, диакритика, `_`/`-` и похожие буквы не делают ник новым
  (`Cap` и кириллическое `Сар`, `Ilya` и `llya`, `Pro100` и `Pr0lOO` считаются одним ником). Таблица похожих букв
  ручная и покрывает кириллицу и греческий против латиницы, это не полный `confusables.txt` Unicode TR39;
- зарезервированные ники (`admin`, `moderator`, `support`, `админ`, ... с цифрами на конце) и запрещённые слова
  (короткий встроенный список, сравнение по скелету, поэтому `sh1t` и `f_u_c_k` тоже отсекаются). Список
  ищет подстроки, поэтому безобидный ник иногда попадает под запрет: тогда переименуйте игрока `gow-admin rename`.
  Свои слова: файл `GOW_NICK_BLOCKLIST_FILE` (по слову в строке, например `/data/nick-blocklist.txt` на томе).

Миграция `0004` пересчитывает `nick_key` существующих игроков по новому правилу; если два ника теперь совпадают,
у более позднего ключ получает суффикс `#<id>`, и его стоит переименовать.

### Админ-скрипт `gow-admin`

```sh
docker compose exec app gow-admin show <игрок>            # id или ник
docker compose exec app gow-admin rename <игрок> <ник>
docker compose exec app gow-admin block <игрок>
docker compose exec app gow-admin unblock <игрок>
```

Заблокированный аккаунт получает 403 на каждый HTTP-запрос и отказ при следующем подключении к WebSocket матча;
уже идущий матч доходит до конца или до технического поражения по таймеру переподключения. `rename` проверяет формат
и уникальность, но не списки запрещённых слов (решает оператор). Без Docker: `uv run gow-admin ...` с тем же
`GOW_DATABASE_URL`. Скрипт работает с базой при запущенном сервере (SQLite WAL).

### Что не сделано

Жалобы игроков на ники и логирование блокировок не входят в issue: блокировки видны в логе контейнера только как
403 в запросах. `[вручную]` Первый список запрещённых слов составлен автором кода: владельцу стоит просмотреть его
и дополнить под свою аудиторию.
