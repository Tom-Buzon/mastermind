let toastEl = null;
export function toast(msg) {
  if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; document.body.appendChild(toastEl); }
  toastEl.textContent = msg; toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 2000);
}
