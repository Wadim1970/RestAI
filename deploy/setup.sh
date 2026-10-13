#!/usr/bin/env bash
# Установка RestAI (гостевое приложение + приложение официанта) на свой сервер
# вместо Vercel. Ubuntu 20.04/22.04/24.04. Запускать от обычного пользователя
# с sudo (не от root):
#
#   WAITER_DOMAIN=<домен официанта> bash /opt/restai/RestAI/deploy/setup.sh
#
# Скрипт идемпотентный — можно запускать повторно, он доделает недостающее.
# Предварительно: репозиторий RestAI склонирован в /opt/restai/RestAI через
# deploy-ключ (см. deploy/README.md).
set -euo pipefail

GUEST_DOMAIN="${GUEST_DOMAIN:-guest.restai.pro}"
WAITER_DOMAIN="${WAITER_DOMAIN:?Укажите домен приложения официанта: WAITER_DOMAIN=... bash setup.sh}"
ROOT=/opt/restai
GUEST_DIR="$ROOT/RestAI"
WAITER_DIR="$ROOT/Waiter-app"
GUEST_BRANCH="${GUEST_BRANCH:-main}"
WAITER_BRANCH="${WAITER_BRANCH:-RestAI-weiter}"
ME="$(id -un)"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m!! %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] && die "Запускайте от обычного пользователя с sudo, не от root."
[ -d "$GUEST_DIR/.git" ] || die "Нет $GUEST_DIR — сначала склонируйте RestAI (deploy/README.md)."

step "Системные пакеты (nginx, git, curl)"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx git curl ca-certificates >/dev/null

step "Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs >/dev/null
fi
node -v

step "pm2"
command -v pm2 >/dev/null || sudo npm install -g pm2 --silent
pm2 -v

step "Код приложения официанта"
if [ ! -d "$WAITER_DIR/.git" ]; then
  git clone -q -b "$WAITER_BRANCH" git@github-waiter:Wadim1970/Waiter-app.git "$WAITER_DIR" \
    || die "Не удалось склонировать Waiter-app. Добавлен ли deploy-ключ restai_waiter в GitHub (deploy/README.md)?"
fi
git -C "$GUEST_DIR" fetch -q origin && git -C "$GUEST_DIR" checkout -q "$GUEST_BRANCH" && git -C "$GUEST_DIR" pull -q --ff-only
git -C "$WAITER_DIR" fetch -q origin && git -C "$WAITER_DIR" checkout -q "$WAITER_BRANCH" && git -C "$WAITER_DIR" pull -q --ff-only

step "Файлы окружения (.env.production)"
missing=0
if [ ! -f "$GUEST_DIR/.env.production" ]; then
  cat > "$GUEST_DIR/.env.production" <<'EOF'
# Гостевое приложение. Значения — те же, что в Vercel → Settings → Environment Variables.
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_WAITER_API_URL=
VITE_VOICE_RELAY_URL=
EOF
  missing=1
fi
if [ ! -f "$WAITER_DIR/.env.production" ]; then
  cat > "$WAITER_DIR/.env.production" <<'EOF'
# Приложение официанта. Значения — те же, что в Vercel → Settings → Environment Variables.
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_SUPABASE_WAITER_URL=
VITE_SUPABASE_WAITER_ANON_KEY=
VITE_API_URL=
VITE_VAPID_PUBLIC_KEY=
# Серверные (только для /api, в браузер не попадают):
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
# Токен админки для пар блюд (deploy/README.md, «Пары блюд»): openssl rand -hex 24
PAIRINGS_ADMIN_TOKEN=
EOF
  missing=1
fi
chmod 600 "$GUEST_DIR/.env.production" "$WAITER_DIR/.env.production"
if [ "$missing" -eq 1 ]; then
  die "Созданы шаблоны:
   $GUEST_DIR/.env.production
   $WAITER_DIR/.env.production
Заполните их значениями из Vercel (nano <файл>) и запустите скрипт ещё раз."
fi
for f in "$GUEST_DIR/.env.production" "$WAITER_DIR/.env.production"; do
  grep -qE '^VITE_SUPABASE_URL=.+' "$f" || die "В $f не заполнен VITE_SUPABASE_URL."
done

step "Сборка гостевого приложения"
(cd "$GUEST_DIR" && npm ci --no-audit --no-fund --loglevel=error && npm run build)

step "Сборка приложения официанта"
(cd "$WAITER_DIR" && npm ci --no-audit --no-fund --loglevel=error && npm run build)

step "API-процессы (pm2)"
pm2 delete restai-guest-api  >/dev/null 2>&1 || true
pm2 delete restai-waiter-api >/dev/null 2>&1 || true
pm2 start "$GUEST_DIR/deploy/api-server.mjs"  --name restai-guest-api  -- --dir "$GUEST_DIR"  --port 3001
pm2 start "$GUEST_DIR/deploy/api-server.mjs"  --name restai-waiter-api -- --dir "$WAITER_DIR" --port 3002
pm2 save
# Автозапуск pm2 после перезагрузки сервера.
sudo env PATH="$PATH" pm2 startup systemd -u "$ME" --hp "$HOME" >/dev/null

step "nginx"
sudo mkdir -p /var/cache/nginx/restai_api
sed -e "s/__GUEST_DOMAIN__/$GUEST_DOMAIN/g" -e "s/__WAITER_DOMAIN__/$WAITER_DOMAIN/g" \
  "$GUEST_DIR/deploy/nginx.conf.template" | sudo tee /etc/nginx/sites-available/restai >/dev/null
sudo ln -sf /etc/nginx/sites-available/restai /etc/nginx/sites-enabled/restai
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

step "Проверка"
sleep 1
curl -fsS http://127.0.0.1:3001/api/__health; echo
curl -fsS http://127.0.0.1:3002/api/__health; echo
code_g=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $GUEST_DOMAIN"  http://127.0.0.1/)
code_w=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $WAITER_DOMAIN" http://127.0.0.1/)
echo "Гостевое приложение через nginx: HTTP $code_g"
echo "Приложение официанта через nginx: HTTP $code_w"

printf '\n\033[1;32mГотово.\033[0m Дальше: переключить DNS на этот сервер и выполнить deploy/enable-https.sh\n'
