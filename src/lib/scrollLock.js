// Страница под окном не должна прокручиваться. `body { overflow: hidden }`
// Safari на iPhone при свайпе пальцем не соблюдает: дотянули текст в окне
// до конца — жест уходит на меню под окном, и следующие свайпы обратно
// сначала возвращают меню, а текст в окне стоит. Поэтому страницу
// «замораживаем»: body — fixed на текущей прокрутке, при закрытии —
// возвращаем на то же место. Окна бывают одно поверх другого — считаем.

let locks = 0;
let saved = null;

export function lockBodyScroll() {
  if (locks++ === 0) {
    const b = document.body.style;
    saved = { y: window.scrollY, position: b.position, top: b.top, left: b.left, right: b.right, width: b.width, overflow: b.overflow };
    Object.assign(b, { position: 'fixed', top: `-${saved.y}px`, left: '0', right: '0', width: '100%', overflow: 'hidden' });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks > 0 || !saved) return;
    const { y, ...style } = saved;
    saved = null;
    Object.assign(document.body.style, style);
    window.scrollTo(0, y);
  };
}

// Прокручиваемый блок внутри окна не должен упираться в край: у края
// iPhone отдаёт жест наружу (а старые iOS не знают overscroll-behavior).
// Перед касанием сдвигаем его на 1 px от края — жест остаётся в блоке.
export function keepOffEdge(el) {
  if (!el || el.scrollHeight <= el.clientHeight) return;
  const max = el.scrollHeight - el.clientHeight;
  if (el.scrollTop <= 0) el.scrollTop = 1;
  else if (el.scrollTop >= max) el.scrollTop = max - 1;
}
