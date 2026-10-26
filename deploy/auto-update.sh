#!/usr/bin/env bash
# Автовыкладка: как было на Vercel — изменения в рабочих ветках GitHub сами
# доезжают до сервера. Раз в 2 минуты (cron) смотрит, появились ли новые
# коммиты, и если да — запускает update.sh для этого приложения:
#
#   RestAI       main           → update.sh guest   (гостевое приложение и его API)
#   Waiter-app   RestAI-weiter  → update.sh waiter  (приложение официанта и API админки)
#   Admin-restai main           → update.sh admin   (панель администратора)
#
# Сайт restai.pro обновляет свой cron (site-sync.sh). Миграции базы — по-прежнему
# вручную на сервере базы: автоматически их запускать нельзя.
#
#   bash /opt/restai/RestAI/deploy/auto-update.sh            # проверить сейчас
#   bash /opt/restai/RestAI/deploy/auto-update.sh install    # поставить в cron
#
# Лог — /opt/restai/auto-update.log (пишется только когда что-то выкладывали).
set -uo pipefail
ROOT="${RESTAI_ROOT:-/opt/restai}"
SELF="$ROOT/RestAI/deploy/auto-update.sh"
LOG="$ROOT/auto-update.log"

if [ "${1:-}" = install ]; then
  LINE="*/2 * * * * bash $SELF >> $LOG 2>&1"
  ( crontab -l 2>/dev/null | grep -v 'deploy/auto-update.sh'; echo "$LINE" ) | crontab -
  echo "Готово: проверка раз в 2 минуты. Лог — $LOG"
  exit 0
fi

# У cron короткий PATH — node, npm и pm2 могут лежать в /usr/local/bin.
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

# Одна выкладка за раз: сборка идёт дольше двух минут.
exec 9>"$ROOT/.auto-update.lock"
flock -n 9 || exit 0

# Что уже выложено — $ROOT/.deployed-<цель> (коммит). Нет файла — считаем
# выложенным то, что сейчас в папке (первый запуск после установки).
# Сборка коммита упала — второй раз его не пробуем ($ROOT/.failed-<цель>),
# ждём следующий коммит (или ручной update.sh).
deploy() {  # $1=цель update.sh $2=папка $3=ветка
  local target="$1" dir="$2" branch="$3"
  local done_file="$ROOT/.deployed-$target" fail_file="$ROOT/.failed-$target"
  [ -d "$dir/.git" ] || return 0
  git -C "$dir" fetch -q origin "$branch" 2>/dev/null || { echo "$(date '+%F %T') не удалось скачать $dir ($branch)"; return 0; }
  local want; want="$(git -C "$dir" rev-parse "origin/$branch")"
  [ -f "$done_file" ] || git -C "$dir" rev-parse HEAD > "$done_file"
  [ "$want" = "$(cat "$done_file")" ] && return 0
  [ "$want" = "$(cat "$fail_file" 2>/dev/null)" ] && return 0

  echo "$(date '+%F %T') выкладываю $target: $(git -C "$dir" log --oneline -1 "$want")"
  if bash "$ROOT/RestAI/deploy/update.sh" "$target"; then
    echo "$want" > "$done_file"
    rm -f "$fail_file"
    echo "$(date '+%F %T') $target — готово"
  else
    echo "$want" > "$fail_file"
    echo "$(date '+%F %T') $target — ОШИБКА выкладки (см. выше); этот коммит больше не пробую — исправьте и влейте новый или запустите update.sh $target вручную"
  fi
}

deploy guest  "$ROOT/RestAI"       main
deploy waiter "$ROOT/Waiter-app"   RestAI-weiter
deploy admin  "$ROOT/Admin-restai" main
