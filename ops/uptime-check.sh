#!/usr/bin/env bash
# Простой аптайм-мониторинг ключевых точек. Шлёт в Telegram ТОЛЬКО при смене
# состояния (упал / поднялся), чтобы не спамить. Запускать по cron каждые ~3 мин
# (можно на любом сервере с интернетом — проверки внешние).
#
# Настройка Telegram:
#   1) в @BotFather создать бота → получить TOKEN;
#   2) написать боту любое сообщение, затем открыть
#      https://api.telegram.org/bot<TOKEN>/getUpdates → взять chat.id;
#   3) прописать оба значения ниже (или через переменные окружения в cron).
#
# Пример cron:
#   */3 * * * * TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy /home/user1/RestAI/ops/uptime-check.sh >> /var/log/uptime.log 2>&1
set -uo pipefail

TG_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TG_CHAT="${TELEGRAM_CHAT_ID:-}"
STATE_DIR="${STATE_DIR:-/root/uptime-state}"
mkdir -p "$STATE_DIR"

# имя|url  — «up», если сервер ответил кодом 200..499 (жив, пусть даже 401);
# «down» — если 000 (не достучались) или 5xx (сервер в ошибке).
CHECKS=(
  "waiter-api|https://api.restai.pro/health"
  "Гостевое приложение|https://guest.restai.pro/"
  "Приложение официанта|https://waiter.restai.pro/"
  "База (Supabase REST)|https://supabase.insis.pro/rest/v1/"
)

notify() {
  local text="$1"
  if [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ]; then
    curl -s -m 10 "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TG_CHAT}" \
      --data-urlencode "text=${text}" >/dev/null || true
  else
    echo "[no telegram] $text"
  fi
}

for entry in "${CHECKS[@]}"; do
  IFS='|' read -r name url <<< "$entry"
  code="$(curl -s -o /dev/null -m 12 -w '%{http_code}' "$url" || echo 000)"
  statefile="$STATE_DIR/$(printf '%s' "$name" | md5sum | cut -c1-8)"
  prev="up"; [ -f "$statefile" ] && prev="$(cat "$statefile")"

  if [ "$code" -ge 200 ] && [ "$code" -lt 500 ]; then
    [ "$prev" != "up" ] && notify "✅ Восстановлен: $name (HTTP $code)"
    echo up > "$statefile"
  else
    [ "$prev" != "down" ] && notify "🔴 Недоступен: $name (HTTP $code)"
    echo down > "$statefile"
  fi
done
