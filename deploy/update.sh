#!/usr/bin/env bash
# Выкатить свежий код на сервер (замена «git push → Vercel задеплоил»):
#   bash /opt/restai/RestAI/deploy/update.sh            # оба приложения
#   bash /opt/restai/RestAI/deploy/update.sh guest      # только гостевое
#   bash /opt/restai/RestAI/deploy/update.sh waiter     # только официанта
#   bash /opt/restai/RestAI/deploy/update.sh site       # только сайт restai.pro
#
# Сайт обновляется и сам: cron раз в 5 минут (deploy/setup-site.sh).
set -euo pipefail
ROOT=/opt/restai
what="${1:-all}"

deploy() {  # $1=папка $2=ветка $3=pm2-процесс
  echo "==> $1 ($2)"
  git -C "$1" fetch -q origin
  git -C "$1" checkout -q "$2"
  git -C "$1" pull -q --ff-only
  (cd "$1" && npm ci --no-audit --no-fund --loglevel=error && npm run build)
  pm2 reload "$3" --update-env
}

[ "$what" = all ] || [ "$what" = guest ]  && deploy "$ROOT/RestAI"     main          restai-guest-api
[ "$what" = all ] || [ "$what" = waiter ] && deploy "$ROOT/Waiter-app" RestAI-weiter restai-waiter-api
if [ "$what" = all ] || [ "$what" = site ]; then
  [ -d "$ROOT/site-src/.git" ] && bash "$ROOT/site-src/deploy/site-sync.sh" --pull
fi
pm2 save >/dev/null
echo "Готово."
