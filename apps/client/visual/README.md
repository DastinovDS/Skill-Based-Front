# Скриншот-тесты карты (CLI-04, #60)

Playwright открывает dev-экран клиента с фиксированной сценой (`/?scene=<id>`) и сравнивает
канвас с эталоном. Сцены собраны в `src/dev/scenarios.ts` из фикстур протокола
`packages/protocol/fixtures/server/snapshot*.json`, каждая на своей карте и «заморожена» на тике
снапшота (без анимации):

| Сцена            | Карта     | Что показывает                                                                                                                                                            |
| ---------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `snapshot`       | `diamond` | свои группы в городе и на дороге, пакет, «Защита» и запланированный приказ противника, присутствие противника без чисел, отметка боя                                      |
| `snapshot_fog`   | `line3`   | склад с полной полоской, намерение противника, город в тумане: штриховка, затемнение, призрак памяти с возрастом `-0:21`                                                  |
| `snapshot_clash` | `siege`   | три группы в одном городе (пакет точек, масштаб для группы больше 10), противник с точными числами, режимы «защита» и «стройка» противника, стрелки обеих сторон, два боя |

Команды (из корня репозитория):

- `pnpm -C apps/client exec playwright install chromium`: один раз, скачать браузер;
- `pnpm -C apps/client test:visual`: сравнить с эталонами (dev-сервер поднимается сам);
- `pnpm -C apps/client test:visual:update`: записать эталоны заново после намеренной правки вида.

Эталоны лежат в `visual/scenes.spec.ts-snapshots/` отдельно для каждой платформы
(`-darwin`, `-linux`): шрифт и растеризатор отличаются. Допуск: 1% пикселей.

Linux-эталоны для CI пишутся в контейнере Playwright той же версии, что в `package.json`
(из корня репозитория):

```sh
docker run --rm -v "$PWD":/src:ro -v "$PWD/apps/client/visual":/out mcr.microsoft.com/playwright:v1.63.0-noble \
  bash -c 'mkdir /work && cd /src && tar --exclude=node_modules --exclude=.git --exclude=.venv -cf - . | tar -xf - -C /work \
  && cd /work/apps/client && corepack enable && pnpm install --frozen-lockfile \
  && CI=1 pnpm exec playwright test --update-snapshots; cp -r visual/scenes.spec.ts-snapshots/. /out/scenes.spec.ts-snapshots/'
```

CI запускает их отдельной задачей `visual` (не входит в обязательные `py`, `web`, `docker`).
Упавшее сравнение кладёт фактические кадры и разницу в артефакт `visual-diff`.
