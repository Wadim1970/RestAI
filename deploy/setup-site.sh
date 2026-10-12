#!/usr/bin/env bash
# Перенос сайта restai.pro (главная, адресные страницы, визитки, презентация)
# с GitHub Pages на этот сервер. Запускать от обычного пользователя с sudo,
# после deploy/setup.sh (нужны nginx и deploy-ключ github-restai):
#
#   bash /opt/restai/RestAI/deploy/setup-site.sh
#
# Идемпотентный — можно запускать повторно.
set -euo pipefail

SITE_DOMAIN="${SITE_DOMAIN:-restai.pro}"
ROOT=/opt/restai
SRC="$ROOT/site-src"
HERE="$(cd "$(dirname "$0")" && pwd)"
ME="$(id -un)"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m!! %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] && die "Запускайте от обычного пользователя с sudo, не от root."
command -v nginx >/dev/null || die "nginx не установлен — сначала deploy/setup.sh."
command -v rsync >/dev/null || sudo apt-get install -y -qq rsync >/dev/null

step "Копия репозитория для сайта ($SRC)"
# Недокачанная копия (прерванный clone: .git есть, коммитов нет) — качаем заново.
if [ -d "$SRC" ] && ! git -C "$SRC" rev-parse -q --verify HEAD >/dev/null 2>&1; then
  rm -rf "$SRC"
fi
if [ ! -d "$SRC/.git" ]; then
  git clone -q --depth 1 -b main git@github-restai:Wadim1970/RestAI.git "$SRC" \
    || die "Не удалось склонировать RestAI через github-restai (deploy/README.md, шаг 1)."
fi

step "Сборка сайта"
# Скрипт из основной копии: в $SRC он появится только после первого --pull
# (копия могла остаться от раннего клона, где deploy/site-sync.sh ещё не было).
SITE_SRC="$SRC" bash "$HERE/site-sync.sh" --pull

step "Автообновление (cron, каждые 5 минут)"
line="*/5 * * * * bash $SRC/deploy/site-sync.sh --pull >> $ROOT/site-sync.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'deploy/site-sync.sh' ; echo "$line" ) | crontab -
crontab -l | grep site-sync

step "nginx"
sed -e "s/__SITE_DOMAIN__/$SITE_DOMAIN/g" "$HERE/nginx-site.conf.template" \
  | sudo tee /etc/nginx/sites-available/restai-site >/dev/null
sudo ln -sf /etc/nginx/sites-available/restai-site /etc/nginx/sites-enabled/restai-site
sudo nginx -t
sudo systemctl reload nginx

step "Проверка"
for path in / /presentation/ /card/ /card-zuev/ /p/bontempi-2026/ /p/README.md; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $SITE_DOMAIN" "http://127.0.0.1$path")
  echo "  $path → HTTP $code"
done
echo "  (README.md должен быть 404 — так и задумано)"

printf '\n\033[1;32mГотово.\033[0m Дальше: DNS restai.pro и www на этот сервер, потом\n'
printf '  EMAIL=<почта> bash %s/enable-https.sh site\n' "$HERE"
