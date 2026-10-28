#!/usr/bin/env bash
# Подставить НОВЫЕ ключи Supabase во все .env сервера (после rotate-supabase-keys.sh).
# Запускать на каждом сервере, где есть .env с ключами (сервер приложений, сервер
# БД для waiter-api, сервер голоса).
#
#   bash apply-new-keys.sh --from-file ~/new-supabase-keys.env   # на сервере БД: значения берёт из файла
#   bash apply-new-keys.sh                                      # на другом сервере: ключи вставляются
#                                                               # в запрос (ввод скрыт)
#   bash apply-new-keys.sh --dry                                # только показать, что нашлось
#
# Ищет .env* файлы в $ROOTS (по умолчанию /opt/restai и домашняя папка), правит
# только те строки, где такая переменная уже есть. Перед правкой кладёт копию
# <файл>.bak-keys. Значения на экран не печатаются, только «файл: переменная».
set -euo pipefail

ROOTS="${ROOTS:-/opt/restai $HOME}"
mode="${1:-}"; FROM="${2:-}"

ANON_VARS="VITE_SUPABASE_ANON_KEY VITE_SUPABASE_WAITER_ANON_KEY VITE_SUPABASE_RESTAURANTS_ANON_KEY VITE_SUPABASE_WAITERS_ANON_KEY SUPABASE_ANON_KEY"
SERVICE_VARS="SUPABASE_SERVICE_KEY SUPABASE_WAITER_SERVICE_KEY"
SECRET_VARS="SUPABASE_JWT_SECRET"

val() { grep -E "^$1=" "$2" | head -1 | cut -d= -f2- | tr -d '"'"'"' \r'; }

ANON=""; SERVICE=""; SECRET=""
if [ "$mode" = "--from-file" ]; then
  [ -f "$FROM" ] || { echo "Нет файла $FROM"; exit 1; }
  ANON="$(val ANON_KEY "$FROM")"; SERVICE="$(val SERVICE_ROLE_KEY "$FROM")"; SECRET="$(val JWT_SECRET "$FROM")"
elif [ "$mode" != "--dry" ]; then
  read -rsp "Вставьте новый ANON_KEY (ввод скрыт, Enter — пропустить): " ANON; echo
  read -rsp "Вставьте новый SERVICE_ROLE_KEY (ввод скрыт, Enter — пропустить): " SERVICE; echo
  read -rsp "Вставьте новый JWT_SECRET (нужен только waiter-api на сервере БД, Enter — пропустить): " SECRET; echo
  ANON="$(printf '%s' "$ANON" | tr -d ' \r\n"')"; SERVICE="$(printf '%s' "$SERVICE" | tr -d ' \r\n"')"; SECRET="$(printf '%s' "$SECRET" | tr -d ' \r\n"')"
fi

# Файлы-кандидаты: .env*, кроме примеров, копий и зависимостей.
mapfile -t FILES < <(find $ROOTS -maxdepth 5 -type f -name '.env*' \
  -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' \
  -not -name '*.example' -not -name '*.bak*' -not -name '*.sample' 2>/dev/null | sort -u)

changed=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  # Файл под контролем git (например, закоммиченный .env с публичным ключом):
  # не правим, иначе потом «git pull» при обновлении упрётся в конфликт.
  if git -C "$(dirname "$f")" ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    echo "ПРОПУЩЕН (файл в git): $f"; continue
  fi
  hit=""
  for pair in "ANON:$ANON_VARS" "SERVICE:$SERVICE_VARS" "SECRET:$SECRET_VARS"; do
    kind="${pair%%:*}"; vars="${pair#*:}"
    case "$kind" in ANON) new="$ANON";; SERVICE) new="$SERVICE";; SECRET) new="$SECRET";; esac
    for v in $vars; do
      grep -qE "^$v=" "$f" || continue
      if [ "$mode" = "--dry" ]; then hit="$hit $v"; continue; fi
      [ -n "$new" ] || { echo "ПРОПУЩЕНО (значение не задано): $f: $v"; continue; }
      [ -e "$f.bak-keys" ] || cp -p "$f" "$f.bak-keys"
      q=""; old="$(grep -E "^$v=" "$f" | head -1 | cut -d= -f2-)"
      case "$old" in \"*) q='"';; \'*) q="'";; esac
      sed -i "s|^$v=.*|$v=$q$new$q|" "$f"
      hit="$hit $v"
    done
  done
  if [ -n "$hit" ]; then echo "$f:$hit"; changed=$((changed+1)); fi
done

if [ "$mode" = "--dry" ]; then echo "Найдено файлов с ключами: $changed"; else echo "Обновлено файлов: $changed. Копии прежних значений: <файл>.bak-keys"; fi
