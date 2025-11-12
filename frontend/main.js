// frontend/main.js
import { $, on, todayDDMMYYYY } from "./utils.js";
import { API } from "./api.js";
import { loadConfig, parseDocument } from "./parser.js";
import { exportFromEditor } from "./exporter.js";
import { initCompose, saveFromCompose } from "./compose.js";
import { toast } from "./components/toast.js";
import { attachGutter, drawGutterFor } from "./components/gutter.js";

let editor, gutter, analysisList;

/* =========================
   THEME (jour/nuit)
   ========================= */
function getSystemPrefersDark() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function applyTheme(theme) {
  document.body.dataset.theme = theme;                 // "dark" | "light"
  localStorage.setItem("mm-theme", theme);
  const btn = $("#btn-theme");
  if (btn) btn.textContent = theme === "dark" ? "🌙" : "🌞";
}
function initTheme() {
  const saved = localStorage.getItem("mm-theme");
  const theme = saved || (getSystemPrefersDark() ? "dark" : "light");
  applyTheme(theme);
  const btn = $("#btn-theme");
  if (btn) {
    btn.addEventListener("click", () => {
      const next = (document.body.dataset.theme === "dark") ? "light" : "dark";
      applyTheme(next);
    });
  }
  // suit les changements système si l’utilisateur n’a pas overridé
  if (!saved && window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = e => applyTheme(e.matches ? "dark" : "light");
    try { mq.addEventListener("change", handler); } catch { mq.addListener(handler); }
  }
}

/* =========================
   SNIPPETS dynamiques (lisent window.__CONFIG)
   ========================= */
function snippetDate() {
  const cfg = window.__CONFIG;
  const t = new Date();
  const dd = String(t.getDate()).padStart(2, "0");
  const mm = String(t.getMonth() + 1).padStart(2, "0");
  const yyyy = t.getFullYear();
  return cfg.date.linePrefix.replace("{DD/MM/YYYY}", `${dd}/${mm}/${yyyy}`) + "\n";
}
function snippetSection(name = "Mon_Projet") {
  const cfg = window.__CONFIG;
  const start = cfg.section.startPrefix.replace("{name}", name);
  const end   = cfg.section.endLine;
  // 4 lignes vides au centre + curseur qu’on placera juste après le header
  return `${start}\n\n\n\n${end}\n`;
}
function snippetTag(name = "tag") {
  const cfg = window.__CONFIG;
  const open  = cfg.tags.open.replace("{name}", name);
  const close = cfg.tags.close.replace("{name}", name);
  return `${open}\n${close}\n`;
}
function snippetTable() {
  return (
    "| Col1 | Col2 |\n" +
    "| ---  | ---  |\n" +
    "| a    | b    |\n" +
    "| c    | d    |\n"
  );
}

/* =========================
   INIT
   ========================= */
async function init() {
  initTheme();

  // charge la config et garde une copie globale
  await loadConfig();
  window.__CONFIG = await API.getConfig();

  // gestion des tabs + redraw arcs après switch (EDIT & COMPOSE)
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach(btn => on(btn, "click", () => {
    tabs.forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tabview").forEach(s => s.classList.remove("active"));
    btn.classList.add("active");
    $("#tab-" + btn.dataset.tab).classList.add("active");

    // double rAF : garantit layout stable avant redraw
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (window.__CONFIG) {
          const ed = $("#editor"), gc = $("#gutter-arcs");
          if (ed && gc) drawGutterFor(ed, gc, window.__CONFIG);
          const mx = $("#mixer"), mg = $("#mixer-gutter");
          if (mx && mg) drawGutterFor(mx, mg, window.__CONFIG);
        }
      })
    );
  }));

  // refs UI
  editor = $("#editor");
  gutter = $("#gutter-arcs");
  analysisList = $("#analysis-list");

  // branche la visualisation d’arcs sur l’éditeur principal (persistant)
  attachGutter(editor, gutter, () => window.__CONFIG);

  /* --------- Boutons snippets (lisent toujours la config courante) --------- */
  on($("#btn-date"), "click", () => insertAtCursor(editor, snippetDate()));

  on($("#btn-section"), "click", () => {
    const name = "Mon_Projet";
    const s = snippetSection(name);
    const ta = editor;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const before = ta.value.substring(0, start), after = ta.value.substring(end);
    ta.value = before + s + after;

    // place le curseur juste après la ligne d’en-tête `startPrefix\n`
    const headerLen = (window.__CONFIG.section.startPrefix.replace("{name}", name) + "\n").length;
    ta.selectionStart = ta.selectionEnd = start + headerLen;
    ta.focus();
    analyze(); // met à jour badges + arcs
  });

  on($("#btn-tag"), "click", () => insertAtCursor(editor, snippetTag("tag")));
  on($("#btn-table"), "click", () => insertAtCursor(editor, snippetTable()));
  on($("#btn-checklist"), "click", () =>
    insertAtCursor(editor, "- [ ] Item 1\n- [ ] Item 2\n- [ ] Item 3\n")
  );

  // actions principales
  on($("#btn-export"), "click", async () => {
    await exportFromEditor(editor.value);
    // NOTE: tu as ajouté dans exporter.js l’émission de `projectFilesChanged`
    // Compose écoutera cet évènement et se mettra à jour.
  });
  on($("#btn-config"), "click", openConfigModal);

  // écoute saisie/scroll sur l’éditeur
  on(editor, "input", analyzeDebounced);
  on(editor, "scroll", () => {
    if (window.__CONFIG) drawGutterFor(editor, gutter, window.__CONFIG);
  });

  // premier rendu badges + arcs
  analyze();

  // initialise l’onglet Compose (son gutter est géré dans compose.js)
  await initCompose();

  // si la config change (via modal), re-analyse + redraw immédiat
  on(document, "configChanged", () => {
    analyze();
    if (window.__CONFIG) drawGutterFor(editor, gutter, window.__CONFIG);
  });
}

/* =========================
   Utils d’édition
   ========================= */
function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart, end = textarea.selectionEnd;
  const before = textarea.value.substring(0, start), after = textarea.value.substring(end);
  textarea.value = before + text + after;
  textarea.selectionStart = textarea.selectionEnd = start + text.length;
  textarea.focus();
  analyze();
}
const analyzeDebounced = debounce(analyze, 250);
function debounce(fn, ms){ let t=null; return function(){ clearTimeout(t); t=setTimeout(() => fn.apply(this, arguments), ms); }; }

/* =========================
   Analyse + badges + arcs
   ========================= */
function analyze() {
  try {
    const result = parseDocument(editor.value);
    renderAnalysis(result);
    if (window.__CONFIG) drawGutterFor(editor, gutter, window.__CONFIG);
  } catch (e) {
    analysisList.innerHTML = "<li class='badge error'>Erreur config</li> " + e.message;
  }
}
function renderAnalysis(res) {
  const arr = [];
  res.sections.forEach(s => { if (!s.date) arr.push("<li><span class='badge project'>Projet</span> Section sans date</li>"); });
  res.errors.forEach(e => arr.push("<li><span class='badge error'>Erreur</span> " + e + "</li>"));
  res.warnings.forEach(w => arr.push("<li><span class='badge'>Info</span> " + w + "</li>"));
  analysisList.innerHTML = arr.join("");
}

/* =========================
   Modale de config (inclut simplement date/section/tags ici)
   ========================= */
async function openConfigModal() {
  const prev = await API.getConfig();

  const bd=document.createElement("div"); bd.className="modal-backdrop";
  const modal=document.createElement("div"); modal.className="modal";
  const header=document.createElement("header"); header.innerHTML="<div>Configuration des balises</div>";
  const body=document.createElement("div"); body.className="body";
  body.style.display="block"; body.style.padding="12px"; body.style.maxHeight="70vh"; body.style.overflow="auto";

  const fields = [
    ["date.linePrefix", prev.date.linePrefix],
    ["section.startPrefix", prev.section.startPrefix],
    ["section.endLine", prev.section.endLine],
    ["tags.open", prev.tags.open],
    ["tags.close", prev.tags.close],
    // (optionnel) Ajouter ici paths.dataRoot / paths.archiveDir si tu veux
    // ["paths.dataRoot", (prev.paths && prev.paths.dataRoot) || ""],
    // ["paths.archiveDir", (prev.paths && prev.paths.archiveDir) || "archive"],
  ];
  const inputs={};
  fields.forEach(([k,v])=>{
    const row=document.createElement("div"); row.style.marginBottom="8px";
    const lab=document.createElement("label"); lab.textContent=k; lab.style.display="block";
    const inp=document.createElement("input"); inp.type="text"; inp.value=v; inp.style.width="100%";
    row.appendChild(lab); row.appendChild(inp); body.appendChild(row); inputs[k]=inp;
  });

  const footer=document.createElement("footer");
  const btnCancel=document.createElement("button"); btnCancel.textContent="Annuler";
  const btnSave=document.createElement("button"); btnSave.textContent="Sauvegarder"; btnSave.className="primary";

  btnCancel.onclick=()=>bd.remove();
  btnSave.onclick=async()=>{
    if(!confirm("Mastermind va modifier tous vos fichiers pour mettre à jour les balises. Continuer ?")) return;
    const cfg={
      date:{ linePrefix:inputs["date.linePrefix"].value },
      section:{ startPrefix:inputs["section.startPrefix"].value, endLine:inputs["section.endLine"].value },
      tags:{ open:inputs["tags.open"].value, close:inputs["tags.close"].value },
      // paths: { dataRoot: inputs["paths.dataRoot"]?.value || (prev.paths && prev.paths.dataRoot) || "",
      //          archiveDir: inputs["paths.archiveDir"]?.value || (prev.paths && prev.paths.archiveDir) || "archive" }
    };
    await API.saveConfig(cfg, true, prev);
    window.__CONFIG = cfg;
    document.dispatchEvent(new CustomEvent("configChanged"));
    toast("Config sauvegardée");
    bd.remove();
  };

  modal.appendChild(header); modal.appendChild(body); modal.appendChild(footer);
  footer.appendChild(btnCancel); footer.appendChild(btnSave);
  bd.appendChild(modal); document.body.appendChild(bd);
  setTimeout(()=>{ bd.style.display="flex"; },10);
}

/* =========================
   Entrée
   ========================= */
init().catch(err => { console.error(err); alert("Erreur d'initialisation: " + err.message); });
