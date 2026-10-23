#!/usr/bin/env bash
# Панель администратора ресторана на этом сервере (вместо Vercel):
#
#   bash /opt/restai/RestAI/deploy/setup-admin.sh
#   EMAIL=you@mail.ru bash /opt/restai/RestAI/deploy/enable-https.sh admin
#
# Перед этим: DNS-запись admin.restai.pro → IP этого сервера; сервер
# официанта (restai-waiter-api, порт 3002) уже работает — deploy/setup.sh.
# Идемпотентный — можно запускать повторно.
set -euo pipefail

ADMIN_DOMAIN="${ADMIN_DOMAIN:-admin.restai.pro}"
ROOT=/opt/restai
DIR="$ROOT/Admin-restai"
BRANCH="${ADMIN_BRANCH:-main}"
HERE="$(cd "$(dirname "$0")" && pwd)"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m!! %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] && die "Запускайте от обычного пользователя с sudo, не от root."
command -v nginx >/dev/null || die "nginx не установлен — сначала deploy/setup.sh."
command -v node >/dev/null || die "Node.js не установлен — сначала deploy/setup.sh."

step "Код панели ($DIR)"
# Репозиторий открытый — клонируем по https, deploy-ключ не нужен.
if [ -d "$DIR" ] && ! git -C "$DIR" rev-parse -q --verify HEAD >/dev/null 2>&1; then
  rm -rf "$DIR"
fi
if [ ! -d "$DIR/.git" ]; then
  git clone -q -b "$BRANCH" https://github.com/Wadim1970/Admin-restai.git "$DIR" \
    || die "Не удалось склонировать Admin-restai."
fi
git -C "$DIR" fetch -q origin && git -C "$DIR" checkout -q "$BRANCH" && git -C "$DIR" pull -q --ff-only

step "Сборка"
(cd "$DIR" && npm ci --no-audit --no-fund --loglevel=error && npm run build)

step "nginx"
sed -e "s/__ADMIN_DOMAIN__/$ADMIN_DOMAIN/g" "$HERE/nginx-admin.conf.template" \
  | sudo tee /etc/nginx/sites-available/restai-admin >/dev/null
sudo ln -sf /etc/nginx/sites-available/restai-admin /etc/nginx/sites-enabled/restai-admin
sudo nginx -t
sudo systemctl reload nginx

step "Проверка"
sleep 2
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $ADMIN_DOMAIN" http://127.0.0.1/shift/hall)
echo "  Страница «Зал»: HTTP $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $ADMIN_DOMAIN" "http://127.0.0.1/api/admin/hall?restaurantId=dd89773c-0952-4fd1-9510-514094a928ee")
echo "  Данные зала:    HTTP $code"
dns=$(getent hosts "$ADMIN_DOMAIN" | awk '{print $1}' || true)
echo "  DNS $ADMIN_DOMAIN → ${dns:-не найден}"

printf '\n\033[1;32mГотово.\033[0m Дальше — HTTPS: EMAIL=… bash %s/enable-https.sh admin\n' "$HERE"
