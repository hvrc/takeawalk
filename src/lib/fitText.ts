/**
 * Shrinks an element's text until it fits its box (it may wrap to two lines
 * first), down to `min` of the inherited size. Used for polaroid captions so a
 * long one stays fully visible instead of being cut off.
 */
export function fitText(el: HTMLElement | null, min = 0.45) {
  if (!el) return
  let scale = 1
  el.style.fontSize = ''
  const overflowing = () => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1
  while (overflowing() && scale > min) {
    scale = Math.max(min, scale - 0.05)
    el.style.fontSize = `${scale}em`
  }
}
