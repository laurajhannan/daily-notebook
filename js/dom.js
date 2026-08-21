/* dom.js — one tiny element builder, shared by every view module.
 *
 * (Not in the original file plan; it exists so the view modules don't each
 * carry a copy, and so nothing has to import from app.js and create a cycle.)
 */

/**
 * el('p', { class: 'x', text: 'hello' }, [child, 'text'])
 * Attributes: `text` sets textContent, `class` sets className, `true` means a
 * bare boolean attribute, null/undefined/false are skipped.
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** Remove every child of a node. */
export function empty(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}
