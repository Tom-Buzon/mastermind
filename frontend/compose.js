// frontend/compose.js
import { API } from "./api.js";
import { loadConfig, parseDocument, getRegex } from "./parser.js";
import { on, $, $all } from "./utils.js";
import { toast } from "./components/toast.js";
import { showDiffModal } from "./components/modal.js";
import { attachGutter, drawGutterFor } from "./components/gutter.js";

let STATE = {
  projects: [],
  selectedProjects: new Set(),
  selectedTags: new Set(),
  allTags: new Set(),
  selectedDates: new Set(),
  cache: new Map(),

  cal: {
  year: null,                // nombre (ex: 2025)
  month: null,               // 1..12
  yearsWithData: new Set(),  // ex: {2024,2025}
  monthsWithDataByYear: new Map(), // year -> Set(month numbers)
  }
};

async function refreshProjects() {
  const list = await API.listProjects();
  STATE.projects = list;
  if (STATE.selectedProjects.size === 0) list.forEach(p => STATE.selectedProjects.add(p));
  renderProjectChips();
}
function renderProjectChips() {
  const box = $("#chips-projects"); box.innerHTML = "";
  STATE.projects.forEach(name => {
    const chip = document.createElement("div");
    chip.className = "chip menu" + (STATE.selectedProjects.has(name) ? " active" : "");
    chip.textContent = name;
    chip.onclick = () => {
      if (STATE.selectedProjects.has(name)) STATE.selectedProjects.delete(name);
      else STATE.selectedProjects.add(name);
      renderProjectChips();
      recompute();
    };
    const menu = document.createElement("div"); menu.className = "context-menu";
    const btnArch = document.createElement("button"); btnArch.textContent = "Archiver";
    const btnDel = document.createElement("button"); btnDel.textContent = "Supprimer";
    btnArch.onclick = async (e) => { e.stopPropagation(); await API.archiveProject(name); toast("Archivé " + name); await refreshProjects(); await recompute(); };
    btnDel.onclick = async (e) => { e.stopPropagation(); await API.deleteProject(name); toast("Supprimé " + name); await refreshProjects(); await recompute(); };
    menu.appendChild(btnArch); menu.appendChild(btnDel);
    chip.appendChild(menu);
    chip.oncontextmenu = (e) => { e.preventDefault(); $all(".context-menu").forEach(m => m.style.display="none"); menu.style.display="block"; };
    document.addEventListener("click", () => menu.style.display="none");
    box.appendChild(chip);
  });
}

async function loadCacheForSelected() {
  STATE.cache.clear(); STATE.allTags.clear();
  const rx = getRegex();
  for (const name of STATE.selectedProjects) {
    try {
      const { content } = await API.getProject(name);
      const parsed = parseDocument(content);
      const dates = new Set();
      const tags = new Set();
      const secs = parsed.sections.filter(s => s.project === name);
      secs.forEach(s => { if (s.date) dates.add(s.date); });
      const lines = content.split("\n");
      for (let i=0;i<lines.length;i++){
        const m = rx.reTagOpenSingle.exec(lines[i]);
        if (m) { tags.add(m.groups.tag); STATE.allTags.add(m.groups.tag); }
      }
      STATE.cache.set(name, { raw: content, dates, tags, sections: secs });
      recomputeCalendarDomain();
    } catch(e){}
  }
  if (STATE.selectedTags.size === 0) { STATE.allTags.forEach(t => STATE.selectedTags.add(t)); }
}

function recomputeCalendarDomain() {
  const years = new Set();
  const map = new Map(); // year -> Set(month)

  // récolte toutes les dates des projets sélectionnés
  STATE.cache.forEach(entry => {
    entry.dates.forEach(d => {
      const p = parseDDMMYYYY(d);
      if (!p) return;
      years.add(p.yyyy);
      if (!map.has(p.yyyy)) map.set(p.yyyy, new Set());
      map.get(p.yyyy).add(p.mm);
    });
  });

  STATE.cal.yearsWithData = years;
  STATE.cal.monthsWithDataByYear = map;

  // choisir mois/année par défaut intelligemment
  const now = new Date();
  const defY = now.getFullYear();
  const defM = now.getMonth() + 1;

  // si rien sélectionné encore, essaie d’utiliser le mois/année courants,
  // sinon prends le min(year) et min(month) existants.
  if (!STATE.cal.year) {
    STATE.cal.year = years.size ? Math.min(...Array.from(years)) : defY;
    if (years.has(defY)) STATE.cal.year = defY;
  }
  if (!STATE.cal.month) {
    const setM = map.get(STATE.cal.year) || new Set();
    STATE.cal.month = setM.size ? (setM.has(defM) ? defM : Math.min(...Array.from(setM))) : defM;
  }
}

function renderTagChips() {
  const box = $("#chips-tags"); box.innerHTML = "";
  Array.from(STATE.allTags).sort().forEach(tag => {
    const chip = document.createElement("div");
    chip.className = "chip" + (STATE.selectedTags.has(tag) ? " active" : "");
    chip.textContent = tag;
    chip.onclick = () => {
      if (STATE.selectedTags.has(tag)) STATE.selectedTags.delete(tag);
      else STATE.selectedTags.add(tag);
      buildMixer();
    };
    box.appendChild(chip);
  });
}

function parseDDMMYYYY(str){
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str);
  if (!m) return null;
  return { dd: +m[1], mm: +m[2], yyyy: +m[3] };
}

function renderYearMonthSelectors() {
  const selY = $("#cal-year");
  const selM = $("#cal-month");
  if (!selY || !selM) return;

  // années : on affiche toutes les années présentes dans les données.
  const years = Array.from(STATE.cal.yearsWithData).sort((a,b)=>a-b);
  selY.innerHTML = "";
  years.forEach(y => {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    // ▶ Marquage si cette année contient au moins un mois avec données
    if ((STATE.cal.monthsWithDataByYear.get(y) || new Set()).size > 0) {
      opt.classList.add("has-data");
    }
    selY.appendChild(opt);
  });
  // selection
  if (years.length) {
    if (!years.includes(STATE.cal.year)) STATE.cal.year = years[0];
    selY.value = String(STATE.cal.year);
  }

  // style "active" si l’année a des données
  if (STATE.cal.yearsWithData.has(STATE.cal.year)) selY.classList.add("active");
  else selY.classList.remove("active");

  // mois 1..12
  selM.innerHTML = "";
  const monthNames = ["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Aoû","Sep","Oct","Nov","Déc"];
  const monthsWithData = STATE.cal.monthsWithDataByYear.get(STATE.cal.year) || new Set();
  for (let m=1;m<=12;m++){
    const opt = document.createElement("option");
    opt.value = String(m);
    opt.textContent = monthNames[m-1];
    // ▶ Marquage si ce mois possède des dates pour l’année courante
    if (monthsWithData.has(m)) {
      opt.classList.add("has-data");
    }
    selM.appendChild(opt);
  }
  selM.value = String(STATE.cal.month);

    // S'il n'y a aucun mois dispo, on garde la valeur actuelle, sinon on force un mois “présent”
  if (monthsWithData.size > 0 && !monthsWithData.has(STATE.cal.month)) {
    STATE.cal.month = Math.min(...Array.from(monthsWithData));
  }
  selM.value = String(STATE.cal.month);


  // Style “actif” sur le SELECT (pas la liste)
  if (monthsWithData.has(STATE.cal.month)) selM.classList.add("active");
  else selM.classList.remove("active");

  // handlers
  selY.onchange = () => {
    STATE.cal.year = +selY.value;
    // si le mois courant n’a pas de données, choisis le 1er mois dispo pour cette année (sinon laisse tel quel)
    const ms = STATE.cal.monthsWithDataByYear.get(STATE.cal.year) || new Set();
    if (!ms.has(STATE.cal.month) && ms.size) {
      STATE.cal.month = Math.min(...Array.from(ms));
    }
    renderYearMonthSelectors();
    renderCalendar();   // reconstruit la grille
    buildMixer();       // rafraîchit l’aperçu selon filtre jour
  };
  selM.onchange = () => {
    STATE.cal.month = +selM.value;
    renderYearMonthSelectors();
    renderCalendar();
    buildMixer();
  };
}

function renderCalendar() {
  const box = $("#calendar");
  if (!box) return;
  box.innerHTML = "";

  const year  = STATE.cal.year;
  const month = STATE.cal.month;

  // jours disponibles (projets sélectionnés) pour le mois/année actifs
  const daysSet = new Set();
  STATE.cache.forEach(entry => {
    entry.dates.forEach(d => {
      const p = parseDDMMYYYY(d);
      if (p && p.yyyy === year && p.mm === month) daysSet.add(d);
    });
  });

  // taille mois
  const daysInMonth = new Date(year, month, 0).getDate();

  for (let d = 1; d <= daysInMonth; d++) {
    const dd = String(d).padStart(2, "0");
    const mm = String(month).padStart(2, "0");
    const mark = `${dd}/${mm}/${year}`;

    const cell = document.createElement("div");
    cell.className = "cal-cell";
    cell.textContent = String(d);

    if (daysSet.has(mark)) cell.classList.add("highlight");
    if (STATE.selectedDates.has(mark)) cell.classList.add("active");

    cell.onclick = () => {
      if (!cell.classList.contains("highlight")) return;
      if (STATE.selectedDates.has(mark)) {
        STATE.selectedDates.delete(mark);
        cell.classList.remove("active");
      } else {
        STATE.selectedDates.add(mark);
        cell.classList.add("active");
      }
      buildMixer();
      // pas besoin de rerendre le calendrier entier, la classe active a déjà basculé
    };

    box.appendChild(cell);
  }
}


// Filtrage par tags
function filterSectionByTags(text, rx, selectedTags) {
  const out = [];
  const stack = [];
  const lines = text.split("\n");
  for (let i=0;i<lines.length;i++){
    const line = lines[i];
    const mOpen = rx.reTagOpenSingle.exec(line);
    if (mOpen){ const t=mOpen.groups.tag; stack.push(t); if (selectedTags.has(t)) out.push(line); continue; }
    const mClose = rx.reTagCloseSingle.exec(line);
    if (mClose){ const t=mClose.groups.tagc; const idx=stack.lastIndexOf(t); if (idx!==-1) stack.splice(idx,1); if (selectedTags.has(t)) out.push(line); continue; }
    if (stack.length===0){ out.push(line); }
    else { const visible = stack.every(t => selectedTags.has(t)); if (visible) out.push(line); }
  }
  return out.join("\n");
}

// Construit le mixeur + redessine les arcs
function buildMixer() {
  const rx = getRegex();
  const cfg = window.__CONFIG;
  const lastDateByProject = new Map();
  let chunks = [];

  for (const name of STATE.selectedProjects) {
    const entry = STATE.cache.get(name); if (!entry) continue;
    const secs = entry.sections.slice().sort((a,b)=>a._order - b._order);
    for (const s of secs) {
      if (STATE.selectedDates.size>0 && (!s.date || !STATE.selectedDates.has(s.date))) continue;
      if (s.date) {
        const last = lastDateByProject.get(name);
        if (last !== s.date) {
          const dateLine = cfg.date.linePrefix.replace("{DD/MM/YYYY}", s.date);
          chunks.push(dateLine);
          lastDateByProject.set(name, s.date);
        }
      }
      chunks.push(filterSectionByTags(s.content, rx, STATE.selectedTags));
    }
  }
  $("#mixer").value = chunks.join("\n");
  renderTagChips();
  recomputeCalendarDomain();     
  renderYearMonthSelectors();    
  renderCalendar(); 

  const mixer = document.getElementById("mixer");
  const canvas = document.getElementById("mixer-gutter");
  if (mixer && canvas && window.__CONFIG) {
    drawGutterFor(mixer, canvas, window.__CONFIG);
  }
}

export async function recompute() {
  await loadConfig();
  await refreshProjects();
  await loadCacheForSelected();
  buildMixer();
}

export function groupPreviewByProject(text) {
  function escReg(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }
  const cfg = window.__CONFIG;
  const st = cfg.section.startPrefix, en = cfg.section.endLine;
  const reStart = new RegExp("^\\s*" + escReg(st).replace("\\{name\\}", "(.+)") + ".*$");
  const reEnd   = new RegExp("^\\s*" + escReg(en) + "\\s*$");
  const lines = text.split("\n");
  const map = new Map();
  let currentProject = null, buf = [];

  function flush(){
    if (currentProject){
      const prev = map.get(currentProject) || "";
      map.set(currentProject, (prev?prev+"\n":"") + buf.join("\n"));
    }
    buf=[]; currentProject=null;
  }

  for (let i=0;i<lines.length;i++){
    const line = lines[i];
    const ms = reStart.exec(line);
    if (ms){
      const nameRest = ms[1].trim();
      const parts = nameRest.split(/\s+/);
      const prj = parts.shift() || "SansNom";
      if (currentProject && prj !== currentProject) flush();
      currentProject = prj;
      buf.push(line);
      continue;
    }
    if (reEnd.test(line)){ buf.push(line); flush(); continue; }
    if (currentProject || /^\s*:::date /.test(line)) buf.push(line);
  }
  if (buf.length) flush();
  return map;
}

export async function saveFromCompose() {
  const map = groupPreviewByProject($("#mixer").value);
  for (const [name, rightContent] of map.entries()) {
    let leftContent = "";
    try { const r = await API.getProject(name); leftContent = r.content || ""; } catch(e){ leftContent=""; }
    if (leftContent === rightContent) continue;
    await new Promise((resolve) => {
      showDiffModal(name + ".md", leftContent, rightContent,
        async (finalText) => { await API.saveProject(name, finalText); toast("Sauvegardé " + name); resolve(); },
        () => resolve()
      );
    });
  }
  document.dispatchEvent(new CustomEvent("projectFilesChanged"));
}

export async function initCompose() {
  // 1) Brancher la visu tout de suite
  const mixer  = $("#mixer");
  const canvas = $("#mixer-gutter");
  attachGutter(mixer, canvas, () => window.__CONFIG);

  // 2) Premier compute + draw
  await recompute();
  renderYearMonthSelectors(); // premier affichage
  if (window.__CONFIG) drawGutterFor(mixer, canvas, window.__CONFIG);

  // 3) Recompute + redraw quand fichiers/config changent
  on(document, "projectFilesChanged", async () => {
    await recompute();
    if (window.__CONFIG) drawGutterFor(mixer, canvas, window.__CONFIG);
  });
  on(document, "configChanged", async () => {
    await recompute();
    if (window.__CONFIG) drawGutterFor(mixer, canvas, window.__CONFIG);
  });

  // 4) Redraw fiable quand on clique l’onglet Compose
  document.querySelectorAll('.tab[data-tab="compose"]').forEach(btn => {
    btn.addEventListener("click", () => {
      requestAnimationFrame(() => {
        if (window.__CONFIG) drawGutterFor(mixer, canvas, window.__CONFIG);
      });
    });
  });

    // 5) Bouton Sauvegarder — on le câble ici pour être indépendant de main.js
  const btnSave = document.getElementById("btn-save-compose");
  if (btnSave) {
    btnSave.addEventListener("click", async (e) => {
      e.preventDefault();
      if (btnSave.dataset.busy === "1") return;
      try {
        btnSave.dataset.busy = "1";
        const oldLabel = btnSave.textContent;
        btnSave.textContent = "Sauvegarde…";

        await saveFromCompose();       // <-- ton export déjà existant

        btnSave.textContent = oldLabel;
        btnSave.dataset.busy = "0";
      } catch (err) {
        btnSave.dataset.busy = "0";
        btnSave.textContent = "Sauvegarder";
        console.error(err);
        try { 
          // si le toast existe déjà :
          (await import("./components/toast.js")).toast("Erreur de sauvegarde");
        } catch (_) {
          alert("Erreur de sauvegarde : " + (err?.message || err));
        }
      }
    });
  }

}
