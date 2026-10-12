#!/usr/bin/env bash
# HTTPS через Let's Encrypt. Запускать ТОЛЬКО после того, как DNS доменов
# указывает на этот сервер (иначе certbot не пройдёт проверку).
#
#   WAITER_DOMAIN=... EMAIL=you@mail.ru bash enable-https.sh   # приложения гостя и официанта
#   EMAIL=you@mail.ru bash enable-https.sh site                # сайт restai.pro и www
#
# Сертификаты раздельные: приложения и сайт переезжают в разное время, и
# недошедший DNS одного не должен ломать выпуск другого.
set -euo pipefail
EMAIL="${EMAIL:?Укажите EMAIL для уведомлений о сертификате}"

if ! command -v certbot >/dev/null; then
  sudo snap install core >/dev/null 2>&1 || true
  sudo snap install --classic certbot
  sudo ln -sf /snap/bin/certbot /usr/bin/certbot
fi

if [ "${1:-apps}" = "site" ]; then
  SITE_DOMAIN="${SITE_DOMAIN:-restai.pro}"
  sudo certbot --nginx --non-interactive --agree-tos -m "$EMAIL" --redirect \
    --cert-name restai-site -d "$SITE_DOMAIN" -d "www.$SITE_DOMAIN"
else
  GUEST_DOMAIN="${GUEST_DOMAIN:-guest.restai.pro}"
  WAITER_DOMAIN="${WAITER_DOMAIN:?Укажите WAITER_DOMAIN}"
  sudo certbot --nginx --non-interactive --agree-tos -m "$EMAIL" --redirect \
    -d "$GUEST_DOMAIN" -d "$WAITER_DOMAIN"
fi
# Продление сертификатов certbot ставит сам (systemd-таймер snap.certbot.renew).
sudo certbot renew --dry-run
