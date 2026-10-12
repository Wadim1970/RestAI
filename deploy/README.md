# Деплой RestAI на свой сервер (вместо Vercel)

Один сервер обслуживает оба приложения:

```
гость ──► nginx :80/:443 ─┬─ guest.restai.pro  → /opt/restai/RestAI/dist   (статика)
                          │                      /api/* → 127.0.0.1:3001     (restai-guest-api)
                          └─ <домен официанта>  → /opt/restai/Waiter-app/dist
                                                 /api/* → 127.0.0.1:3002     (restai-waiter-api)
```

- `deploy/api-server.mjs` запускает функции из `api/` как есть (замена Vercel Functions).
- nginx кэширует `/api/menu` и `/api/branding` на 60 с (замена Vercel Edge-кэша).
- сайт restai.pro (главная, `/p/*`, `/in/*`, визитки `/card/`, `/card-zuev/`, `/presentation/`) — статика из того же репозитория, nginx, вместо GitHub Pages (см. ниже).
- voice-relay остаётся на сервере в Казахстане: OpenAI не принимает запросы с российских IP.

## Первая установка

Все команды выполняются на сервере от обычного пользователя с sudo (не root).

### 1. Доступ к GitHub (deploy-ключи, только чтение)

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/restai_guest  -C "restai-server guest"
ssh-keygen -t ed25519 -N "" -f ~/.ssh/restai_waiter -C "restai-server waiter"
cat >> ~/.ssh/config <<'EOF'
Host github-restai
  HostName github.com
  User git
  IdentityFile ~/.ssh/restai_guest
  IdentitiesOnly yes
Host github-waiter
  HostName github.com
  User git
  IdentityFile ~/.ssh/restai_waiter
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
cat ~/.ssh/restai_guest.pub ~/.ssh/restai_waiter.pub
```

Два выведенных публичных ключа добавить в GitHub:
- `restai_guest.pub` → репозиторий **RestAI** → Settings → Deploy keys → Add deploy key (без галочки «Allow write access»);
- `restai_waiter.pub` → репозиторий **Waiter-app** → так же.

### 2. Код гостевого приложения

```bash
sudo mkdir -p /opt/restai && sudo chown "$USER" /opt/restai
git clone -b main git@github-restai:Wadim1970/RestAI.git /opt/restai/RestAI
```

(При первом подключении SSH спросит про отпечаток github.com — ответить `yes`.)

### 3. Установка

```bash
WAITER_DOMAIN=<домен официанта> bash /opt/restai/RestAI/deploy/setup.sh
```

При первом запуске скрипт создаст шаблоны `.env.production` и остановится. Их нужно заполнить значениями из Vercel (Settings → Environment Variables) и запустить скрипт ещё раз:

```bash
nano /opt/restai/RestAI/.env.production
nano /opt/restai/Waiter-app/.env.production
WAITER_DOMAIN=<домен официанта> bash /opt/restai/RestAI/deploy/setup.sh
```

Скрипт ставит Node 22, nginx и pm2, собирает оба приложения, запускает API и nginx, а в конце печатает проверку.

### 4. Проверка до переключения DNS

С любого компьютера:

```bash
curl -H "Host: guest.restai.pro" http://<IP сервера>/
curl -H "Host: guest.restai.pro" "http://<IP сервера>/api/menu?restaurantId=<id ресторана>"
```

### 5. Переключение DNS и HTTPS

1. В DNS направить `guest.restai.pro` и домен официанта (A-записи) на IP сервера.
2. Когда DNS обновится (`ping guest.restai.pro` показывает новый IP):

```bash
WAITER_DOMAIN=<домен официанта> EMAIL=<почта> bash /opt/restai/RestAI/deploy/enable-https.sh
```

Vercel держим включённым ещё пару дней как запасной вариант.

## Сайт restai.pro (вместо GitHub Pages)

Состав тот же, что публиковал `.github/workflows/pages.yml`: `site/` в корень, плюс `card/`, `card-zuev/`, `presentation/`. README и CNAME не публикуются. Адреса визиток не меняются — QR-коды на них напечатаны.

```bash
git -C /opt/restai/RestAI pull
bash /opt/restai/RestAI/deploy/setup-site.sh
```

Скрипт делает отдельную лёгкую копию репозитория в `/opt/restai/site-src`, собирает сайт в `/opt/restai/site`, ставит nginx для `restai.pro` и `www.restai.pro` (www → без www) и cron: раз в 5 минут подтягивает `main` и пересобирает сайт, если что-то изменилось. Push в `main` доезжает до сайта сам, как раньше с Pages. Лог — `/opt/restai/site-sync.log`.

Проверка до DNS: `curl -H "Host: restai.pro" http://<IP сервера>/presentation/`.

DNS (Reg.ru), записи `restai.pro`:
1. `@` — удалить четыре A-записи `185.199.108–111.153` и **четыре AAAA** `2606:50c0:8000–8003::153` (иначе телефоны с IPv6 продолжат ходить на GitHub), добавить A → IP сервера.
2. `www` — удалить CNAME `wadim1970.github.io.`, добавить A → IP сервера.
3. MX и TXT (Яндекс-почта) не трогать.

Когда `getent hosts restai.pro www.restai.pro` покажет новый IP:

```bash
EMAIL=<почта> bash /opt/restai/RestAI/deploy/enable-https.sh site
```

После этого в GitHub: RestAI → Settings → Pages → удалить custom domain и отключить Pages.

## Обновление (замена «git push → Vercel задеплоил»)

```bash
bash /opt/restai/RestAI/deploy/update.sh          # оба приложения
bash /opt/restai/RestAI/deploy/update.sh guest    # только гостевое
bash /opt/restai/RestAI/deploy/update.sh waiter   # только официанта
bash /opt/restai/RestAI/deploy/update.sh site     # только сайт (обычно не нужно — cron)
```

## Диагностика

```bash
pm2 status                         # живы ли restai-guest-api / restai-waiter-api
pm2 logs restai-guest-api --lines 50
curl -s localhost:3001/api/__health
curl -s localhost:3002/api/__health
sudo nginx -t && sudo tail -50 /var/log/nginx/error.log
```
