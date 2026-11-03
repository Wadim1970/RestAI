#!/usr/bin/env bash
# Тренажёр официанта (Trainer-RestAI) на этом сервере: PWA на своём домене + API.
#
#   TRAINER_DOMAIN=trainer.restai.pro bash /opt/restai/RestAI/deploy/setup-trainer.sh
#   EMAIL=you@mail.ru TRAINER_DOMAIN=trainer.restai.pro bash /opt/restai/RestAI/deploy/enable-https.sh trainer
#
# Перед этим: сервер уже настроен deploy/setup.sh (nginx, Node 22, pm2); DNS-запись
# домена тренажёра → IP этого сервера (для HTTPS). Идемпотентный — можно запускать
# повторно: он доделает недостающее, а при смене настроек пересоберёт и перезапустит.
#
# Репозиторий закрытый: нужен deploy-ключ на ЧТЕНИЕ (скрипт создаст ключ и покажет, куда
# его добавить в GitHub). Дальше код обновляет deploy/auto-update.sh (ветка main).
# Миграции базы и почту (SMTP) в Supabase скрипт не трогает: см. docs/DEPLOY.md
# в репозитории Trainer-RestAI.
set -euo pipefail

TRAINER_DOMAIN="${TRAINER_DOMAIN:-trainer.restai.pro}"
ROOT="${RESTAI_ROOT:-/opt/restai}"
DIR="$ROOT/Trainer-RestAI"
BRANCH="${TRAINER_BRANCH:-main}"
PORT=3003
APP=restai-trainer-api
HERE="$(cd "$(dirname "$0")" && pwd)"
KEY="$HOME/.ssh/restai_trainer"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m!! %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] && die "Запускайте от обычного пользователя с sudo, не от root."
for c in nginx node npm pm2 git curl; do
  command -v "$c" >/dev/null || die "Не найден $c — сначала deploy/setup.sh."
done

step "Доступ к закрытому репозиторию (deploy-ключ)"
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
[ -f "$KEY" ] || ssh-keygen -t ed25519 -N "" -f "$KEY" -C "restai-server trainer" >/dev/null
if ! grep -q '^Host github-trainer$' "$HOME/.ssh/config" 2>/dev/null; then
  cat >> "$HOME/.ssh/config" <<CFG

Host github-trainer
  HostName github.com
  User git
  IdentityFile $KEY
  IdentitiesOnly yes
CFG
  chmod 600 "$HOME/.ssh/config"
fi

step "Код тренажёра ($DIR)"
if [ -d "$DIR" ] && ! git -C "$DIR" rev-parse -q --verify HEAD >/dev/null 2>&1; then
  die "$DIR есть, но это не рабочий клон. Проверьте папку и удалите её вручную, если она пустая."
fi
if [ ! -d "$DIR/.git" ]; then
  if ! git clone -q -b "$BRANCH" git@github-trainer:Wadim1970/Trainer-RestAI.git "$DIR"; then
    printf '\nПубличный ключ — добавьте его в GitHub: Trainer-RestAI → Settings → Deploy keys → Add deploy key (БЕЗ галочки Allow write access):\n\n'
    cat "$KEY.pub"
    die "Не удалось склонировать Trainer-RestAI. После добавления ключа запустите скрипт ещё раз."
  fi
fi
git -C "$DIR" fetch -q origin && git -C "$DIR" checkout -q "$BRANCH" && git -C "$DIR" pull -q --ff-only

step "Файл окружения (.env.production)"
if [ ! -f "$DIR/.env.production" ]; then
  cp "$DIR/.env.example" "$DIR/.env.production"
  chmod 600 "$DIR/.env.production"
  die "Создан $DIR/.env.production — заполните его (docs/DEPLOY.md, раздел 4) и запустите скрипт ещё раз."
fi
chmod 600 "$DIR/.env.production"
for v in VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY SUPABASE_URL SUPABASE_SERVICE_KEY TRAINER_PUBLIC_URL; do
  grep -qE "^$v=[^<>]+$" "$DIR/.env.production" || die "В $DIR/.env.production не заполнено $v (пусто или остался шаблон в <...>)."
done
grep -qE '^TRAINER_PUBLIC_URL=https?://' "$DIR/.env.production" || die "TRAINER_PUBLIC_URL должен начинаться с https:// (иначе QR приглашений не создаётся)."
grep -qE '^ADMIN_TOKEN=.+' "$DIR/.env.production" || echo "  Внимание: ADMIN_TOKEN не задан — коды в ресторанах, кроме учебного, выдать будет нельзя."

step "Сборка"
(cd "$DIR" && npm ci --no-audit --no-fund --loglevel=error && npm run build)

step "API (pm2: $APP, порт $PORT)"
pm2 delete "$APP" >/dev/null 2>&1 || true
pm2 start "$ROOT/RestAI/deploy/api-server.mjs" --name "$APP" -- --dir "$DIR" --port "$PORT"
pm2 save

step "nginx"
sed -e "s#__TRAINER_DOMAIN__#$TRAINER_DOMAIN#g" -e "s#__TRAINER_DIR__#$DIR#g" "$HERE/nginx-trainer.conf.template" \
  | sudo tee /etc/nginx/sites-available/restai-trainer >/dev/null
sudo ln -sf /etc/nginx/sites-available/restai-trainer /etc/nginx/sites-enabled/restai-trainer
sudo nginx -t
sudo systemctl reload nginx

step "Проверка"
sleep 2
curl -fsS "http://127.0.0.1:$PORT/api/__health" >/dev/null && echo "  API:            работает (порт $PORT)" || echo "  API:            НЕ отвечает — pm2 logs $APP"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $TRAINER_DOMAIN" http://127.0.0.1/ || true)
echo "  Приложение:     HTTP ${code:-000} (ожидается 200; 000 — nginx не отвечает)"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $TRAINER_DOMAIN" http://127.0.0.1/mail/magic_link.html || true)
echo "  Шаблон письма:  HTTP ${code:-000} (ожидается 200: Supabase заберёт письмо отсюда)"
dns=$(getent hosts "$TRAINER_DOMAIN" | awk '{print $1}' || true)
echo "  DNS $TRAINER_DOMAIN → ${dns:-не найден}"

printf '\n\033[1;32mГотово.\033[0m Дальше:\n'
printf '  1. HTTPS (когда DNS указывает на сервер): EMAIL=<почта> TRAINER_DOMAIN=%s bash %s/enable-https.sh trainer\n' "$TRAINER_DOMAIN" "$HERE"
printf '  2. Миграции базы и почта в Supabase — docs/DEPLOY.md (репозиторий Trainer-RestAI).\n'
printf '  3. Автообновление уже подхватит тренажёр: bash %s/auto-update.sh install (если ещё не ставили).\n' "$HERE"
