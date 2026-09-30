/** Tiny DOM helpers so UI modules stay framework-free. */

type Child = Node | string;

/** Create an element with attributes and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

/** A labelled control: `<label>text <control></label>`. */
export function labelled(text: string, control: HTMLElement): HTMLLabelElement {
  return el('label', { class: 'control' }, [el('span', { text }), control]);
}

/** A `<select>` with the given options; the first is selected unless `selected` is given. */
export function select(
  options: { value: string; label: string }[],
  selected?: string,
): HTMLSelectElement {
  const node = el('select');
  for (const o of options) {
    const option = el('option', { value: o.value, text: o.label });
    if (o.value === selected) option.selected = true;
    node.append(option);
  }
  return node;
}
