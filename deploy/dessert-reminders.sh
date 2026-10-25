#!/usr/bin/env bash
# Напоминания о десерте: гость в корзине разрешил «чуть позже предложить
# десерт» — когда горячее у него готово (+20 минут; без отметки «готово» —
# через 40 минут), официант получает вызов «Время предложить десерт» и пуш.
#
#   bash /opt/restai/RestAI/deploy/dessert-reminders.sh            # проверить сейчас
#   bash /opt/restai/RestAI/deploy/dessert-reminders.sh install    # поставить в cron (раз в минуту)
#
# Токен — ADMIN_TOKEN (или PAIRINGS_ADMIN_TOKEN) из Waiter-app/.env.production;
# адрес пушей официанта — VITE_WAITER_API_URL гостевого приложения.
set -euo pipefail
SELF="$(readlink -f "$0")"
if [ "${1:-}" = install ]; then
  LINE="* * * * * bash $SELF >> /opt/restai/dessert-reminders.log 2>&1"
  ( crontab -l 2>/dev/null | grep -v 'dessert-reminders.sh'; echo "$LINE" ) | crontab -
  echo "Готово: раз в минуту. Лог — /opt/restai/dessert-reminders.log"
  exit 0
fi

WAITER_ENV="${WAITER_ENV:-/opt/restai/Waiter-app/.env.production}"
GUEST_ENV="${GUEST_ENV:-/opt/restai/RestAI/.env.production}"
val() { grep -E "^$1=" "$2" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' \r'; }
TOKEN="$(val ADMIN_TOKEN "$WAITER_ENV")"; [ -n "$TOKEN" ] || TOKEN="$(val PAIRINGS_ADMIN_TOKEN "$WAITER_ENV")"
[ -n "$TOKEN" ] || { echo "Нет ADMIN_TOKEN / PAIRINGS_ADMIN_TOKEN в $WAITER_ENV"; exit 1; }
PUSH="$(val VITE_WAITER_API_URL "$GUEST_ENV")"

OUT="$(curl -fsS -m 50 -X POST http://127.0.0.1:3002/api/cron/dessert-reminders \
  -H 'Content-Type: application/json' -H "X-Admin-Token: $TOKEN" -d "{\"pushUrl\":\"$PUSH\"}")"
# Пишем в лог только когда что-то произошло — иначе лог растёт каждую минуту.
case "$OUT" in *'"called":0'*'"closed":0'*) ;; *) echo "$(date '+%F %T') $OUT" ;; esac
