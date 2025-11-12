export function $(sel, root) { return (root || document).querySelector(sel); }
export function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
export function on(el, ev, fn) { el.addEventListener(ev, fn); }
export function todayDDMMYYYY() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return dd + "/" + mm + "/" + yy;
}
export function download(filename, text) {
  const blob = new Blob([text], {type: "text/plain;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
export function debounce(fn, ms) {
  let t = null; return function() { clearTimeout(t); const ctx = this, args = arguments; t = setTimeout(() => fn.apply(ctx, args), ms); };
}
