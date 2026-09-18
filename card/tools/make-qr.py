#!/usr/bin/env python3
"""Генератор QR-кода для визитки.

Запуск (из корня репозитория):
    pip install segno pillow
    python3 card/tools/make-qr.py https://example.com/card/

Кладёт рядом три файла:
    card/img/qr.png        — для модалки «QR-код» внутри самой визитки
    card/img/qr-print.png  — крупный, с логотипом в центре, для печати/экрана
    card/img/qr-print.svg  — вектор, если нужна печать на бумаге любого размера

Уровень коррекции ошибок — H (до 30% площади можно перекрыть), поэтому логотип
в центре не мешает сканированию. Поля (border=4 модуля) убирать нельзя: без них
камеры распознают код заметно хуже.
"""
import sys
from pathlib import Path

import segno
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
LOGO = ROOT / 'icons' / 'icon-512.png'
OUT = ROOT / 'img'


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    url = sys.argv[1].strip()
    if not url.startswith(('http://', 'https://')):
        print('Ошибка: нужен полный адрес, начиная с https://')
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    qr = segno.make(url, error='h')

    qr.save(OUT / 'qr.png', scale=10, border=4, dark='#11131B', light='#FFFFFF')
    qr.save(OUT / 'qr-print.svg', scale=10, border=4, dark='#11131B', light='#FFFFFF')

    # Крупный PNG с логотипом в центре.
    qr.save(OUT / 'qr-print.png', scale=24, border=4, dark='#11131B', light='#FFFFFF')
    big = Image.open(OUT / 'qr-print.png').convert('RGBA')
    side = int(big.width * 0.20)
    logo = Image.open(LOGO).convert('RGBA').resize((side, side), Image.LANCZOS)
    pad = int(side * 0.14)
    plate = Image.new('RGBA', (side + pad * 2, side + pad * 2), (255, 255, 255, 255))
    plate.alpha_composite(logo, (pad, pad))
    big.alpha_composite(plate, ((big.width - plate.width) // 2, (big.height - plate.height) // 2))
    big.convert('RGB').save(OUT / 'qr-print.png')

    print(f'QR для {url}')
    for f in ('qr.png', 'qr-print.png', 'qr-print.svg'):
        print(f'  {OUT / f}')
    print('\nПроверьте код камерой ДО того, как печатать его на чём-либо.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
