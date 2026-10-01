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
новых матчей (`POST /internal/drain` изнутри контейнера `app`, эндпоинт отвечает только на loopback,
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
- [ ] Внешняя проверка доступности `https://<DOMAIN>/api/health` (OPS-04, #83).
- [ ] Осушение матчей в `deploy.sh` после SRV-02 (#47).
