#!/usr/bin/env bash
# Сайт restai.pro на своём сервере (замена GitHub Pages, см. .github/workflows/pages.yml).
# Собирает статику из репозитория RestAI в /opt/restai/site:
#
#   /                 → site/          (главная, site/p/*, site/in/*)
#   /card/            → card/          (визитка, QR напечатан — адрес не менять)
#   /card-zuev/       → card-zuev/     (визитка, QR напечатан — адрес не менять)
#   /presentation/    → presentation/  (презентация)
#
#   bash site-sync.sh           # пересобрать из того, что уже скачано
#   bash site-sync.sh --pull    # скачать свежий main и пересобрать, если он изменился
#
# --pull запускает cron каждые 5 минут (ставит deploy/setup-site.sh, скрипт — из
# /opt/restai/RestAI/deploy): push в main →
# через несколько минут изменения на сайте, как раньше с Pages.
#
# Источник — отдельная неглубокая копия репозитория /opt/restai/site-src, а не
# /opt/restai/RestAI: у той копии работает гостевое приложение, и подтягивать в неё
# код по расписанию без пересборки нельзя.

main() {
  set -euo pipefail
  local SRC="${SITE_SRC:-/opt/restai/site-src}"
  local DST="${SITE_DST:-/opt/restai/site}"
  local BRANCH="${SITE_BRANCH:-main}"

  [ -d "$SRC/.git" ] || { echo "Нет $SRC — запустите deploy/setup-site.sh"; exit 1; }

  if [ "${1:-}" = "--pull" ]; then
    local before after
    before="$(git -C "$SRC" rev-parse -q --verify HEAD || true)"
    git -C "$SRC" fetch -q --depth 1 origin "$BRANCH"
    git -C "$SRC" reset -q --hard FETCH_HEAD
    after="$(git -C "$SRC" rev-parse HEAD)"
    # Ничего не поменялось и сайт уже собран — молча выходим (cron).
    if [ "$before" = "$after" ] && [ -f "$DST/index.html" ]; then exit 0; fi
  fi

  STAGE="$(mktemp -d)"
  trap 'rm -rf "$STAGE"' EXIT
  local stage="$STAGE"
  cp -R "$SRC/site/." "$stage/"
  for dir in card card-zuev presentation; do
    cp -R "$SRC/$dir" "$stage/"
  done
  # README — заметки для разработки. В site/p/ он перечисляет адресные страницы
  # под конкретные рестораны, публиковать его нельзя. CNAME нужен только Pages.
  find "$stage" -name 'README.md' -delete
  rm -f "$stage/CNAME"
  find "$stage" -name '.*' -not -path "$stage" -exec rm -rf {} +

  mkdir -p "$DST"
  rsync -a --delete "$stage/" "$DST/"
  chmod -R a+rX "$DST"
  echo "$(date '+%F %T') сайт собран из $(git -C "$SRC" rev-parse --short HEAD)"
}

# Весь код внутри main(): bash дочитывает файл до конца до запуска, и git reset,
# обновляющий этот же скрипт, не ломает текущий прогон.
main "$@"
exit
