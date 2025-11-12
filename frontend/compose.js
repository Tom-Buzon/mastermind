// frontend/compose.js
import { API } from "./api.js";
import { loadConfig, parseDocument, getRegex } from "./parser.js";
import { on, $, $all } from "./utils.js";
import { toast } from "./components/toast.js";
import { showDiffModal } from "./components/modal.js";
import { attachGutter, drawGutterFor } from "./components/gutter.js";

/* =========================
   Helpers
   ========================= */
const escReg = (s)=> s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const parseDDMMYYYY = (str)=>{
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str);
  if (!m) return null;
  return { dd:+m[1], mm:+m[2], yyyy:+m[3] };
};
const cmpDate = (a,b)=>{
  const pa=parseDDMMYYYY(a), pb=parseDDMMYYYY(b);
  if(!pa || !pb) return 0;
  if(pa.yyyy!==pb.yyyy) return pa.yyyy-pb.yyyy;
  if(pa.mm!==pb.mm) return pa.mm-pb.mm;
  return pa.dd-pb.dd;
};

// --- helpers pour extraire/vider des “buckets” de date dans le FULL doc
function extractDatesFromFilteredText(filteredText, cfg){
  const dateRx = new RegExp("^\\s*" + cfg.date.linePrefix.replace("{DD/MM/YYYY}", "(\\d{2}/\\d{2}/\\d{4})") + "\\s*$","m");
  const out = new Set();
  filteredText.split("\n").forEach(line=>{
    const m = dateRx.exec(line);
    if (m) out.add(m[1]);
  });
  return out; // Set("DD/MM/YYYY", ...)
}

// Vide tout le contenu entre une ligne :::date X et la prochaine :::date / EOF,
// mais conserve la ligne :::date X (pour garder la structure et le filtre)
function clearDateBucket(fullText, dateStr, cfg){
  const dateRx = new RegExp("^\\s*" + cfg.date.linePrefix.replace("{DD/MM/YYYY}", "(\\d{2}/\\d{2}/\\d{4})") + "\\s*$");
  const lines = fullText.split("\n");

  // localise le bucket
  let dStart = -1, dEnd = lines.length;
  for (let i=0;i<lines.length;i++){
    const m = dateRx.exec(lines[i]);
    if (m && m[1] === dateStr) { dStart = i; break; }
  }
  if (dStart === -1) return fullText; // rien à faire

  for (let i=dStart+1;i<lines.length;i++){
    if (dateRx.test(lines[i])) { dEnd = i; break; }
  }

  // supprime toutes les lignes du bucket (sauf la ligne de date)
  lines.splice(dStart+1, Math.max(0, dEnd - (dStart+1)));
  return lines.join("\n");
}



// --- visibilité par ligne (true = visible avec les tags actifs)
function visibilityMaskForLines(lines, rx, selectedTags) {
  const mask = [];
  const stack = [];
  for (const line of lines) {
    const mOpen = rx.reTagOpenSingle.exec(line);
    if (mOpen) { stack.push(mOpen.groups.tag); mask.push(selectedTags.has(mOpen.groups.tag)); continue; }
    const mClose = rx.reTagCloseSingle.exec(line);
    if (mClose) { const t = mClose.groups.tagc; const i = stack.lastIndexOf(t); if (i!==-1) stack.splice(i,1); mask.push(selectedTags.has(t)); continue; }
    mask.push(stack.length === 0 ? true : stack.every(t => selectedTags.has(t)));
  }
  return mask;
}

function sectionHasAnyVisibleLine(lines, rx, selectedTags) {
  const mask = visibilityMaskForLines(lines, rx, selectedTags);
  return mask.some(Boolean);
}

// --- merge non-destructif d'une section : remplace seulement les lignes visibles
function mergeSectionPreservingHidden(origLinesArr, editedFilteredArr, rx, selectedTags){
  const vis = visibilityMaskForLines(origLinesArr, rx, selectedTags);
  const merged = [];
  let ei=0;
  for (let i=0;i<origLinesArr.length;i++){
    if (vis[i]) merged.push(ei < editedFilteredArr.length ? editedFilteredArr[ei++] : origLinesArr[i]);
    else merged.push(origLinesArr[i]);
  }
  // lignes supplémentaires ajoutées par l'éditeur → insérer avant @@/ si présent
  if (ei < editedFilteredArr.length) {
    const extras = editedFilteredArr.slice(ei);
    const endIdx = merged.findIndex(l => /^\s*@@\s*\/\s*$/.test(l));
    if (endIdx !== -1) merged.splice(endIdx, 0, ...extras);
    else merged.push(...extras);
  }
  return merged;
}

// --- parse FULL en modèle: date => [{header, lines}]
function buildFullModel(fullText, cfg){
  const lines = fullText.split("\n");
  const stRx = new RegExp("^\\s*" + escReg(cfg.section.startPrefix).replace("\\{name\\}", "(.+)") + ".*$");
  const enRx = new RegExp("^\\s*" + escReg(cfg.section.endLine) + "\\s*$");
  const dateRx = new RegExp("^\\s*" + cfg.date.linePrefix.replace("{DD/MM/YYYY}", "(\\d{2}/\\d{2}/\\d{4})") + "\\s*$");

  const model = new Map(); // dateStr -> array of {header, lines}
  let currentDate = null;

  let i=0;
  while (i<lines.length){
    const d = dateRx.exec(lines[i]);
    if (d){ currentDate = d[1]; if(!model.has(currentDate)) model.set(currentDate, []); i++; continue; }

    const s = stRx.exec(lines[i]);
    if (s){
      const start = i;
      while (i<lines.length && !enRx.test(lines[i])) i++;
      if (i<lines.length) i++; // inclure @@/
      const bloc = lines.slice(start, i);
      const header = bloc[0];
      if (currentDate){
        model.get(currentDate).push({ header, lines: bloc });
      }
      continue;
    }
    i++;
  }
  return model;
}

// --- parse RIGHT filtré en modèle: date => [{header, filteredLines}]
function buildEditedModel(filteredText, cfg){
  const lines = filteredText.split("\n");
  const stRx = new RegExp("^\\s*" + escReg(cfg.section.startPrefix).replace("\\{name\\}", "(.+)") + ".*$");
  const enRx = new RegExp("^\\s*" + escReg(cfg.section.endLine) + "\\s*$");
  const dateRx = new RegExp("^\\s*" + cfg.date.linePrefix.replace("{DD/MM/YYYY}", "(\\d{2}/\\d{2}/\\d{4})") + "\\s*$");

  const model = new Map();
  let currentDate = null;

  let i=0;
  while (i<lines.length){
    const d = dateRx.exec(lines[i]);
    if (d){ currentDate = d[1]; if(!model.has(currentDate)) model.set(currentDate, []); i++; continue; }

    const s = stRx.exec(lines[i]);
    if (s){
      const start = i;
      while (i<lines.length && !enRx.test(lines[i])) i++;
      if (i<lines.length) i++; // inclure @@/
      const bloc = lines.slice(start, i);
      const header = bloc[0];
      if (currentDate){
        model.get(currentDate).push({ header, filteredLines: bloc });
      }
      continue;
    }
    i++;
  }
  return model;
}




// retrouver un bloc par son header exact (ligne 1 du bloc)
function findBlockByHeader(lines, headerLine, cfg){
  const enRx = new RegExp("^\\s*" + escReg(cfg.section.endLine) + "\\s*$");
  for (let i=0;i<lines.length;i++){
    if (lines[i] === headerLine){
      for (let j=i; j<lines.length; j++){
        if (enRx.test(lines[j])) return { start:i, end:j };
      }
    }
  }
  return null;
}

// remonter à la date précédente d'un index
function indexOfPrevDate(lines, iFrom, cfg){
  const dateRx = new RegExp("^\\s*" + cfg.date.linePrefix.replace("{DD/MM/YYYY}", "(\\d{2}/\\d{2}/\\d{4})") + "\\s*$");
  for (let i=iFrom; i>=0; i--){
    const m = dateRx.exec(lines[i]);
    if (m) return { idx:i, date:m[1] };
  }
  return { idx:-1, date:null };
}

function endOfDateBucket(lines, dateIdx, cfg){
  const dateRx = new RegExp("^\\s*" + cfg.date.linePrefix.replace("{DD/MM/YYYY}", "(\\d{2}/\\d{2}/\\d{4})") + "\\s*$");
  let i = lines.length;
  for (let k=dateIdx+1; k<lines.length; k++){
    if (dateRx.test(lines[k])) { i = k; break; }
  }
  return i;
}


/* =========================
   STATE
   ========================= */
let STATE = {
  projects: [],
  selectedProjects: new Set(),
  selectedTags: new Set(),
  allTags: new Set(),
  selectedDates: new Set(),
  cache: new Map(),
  cal: {
    year: null,
    month: null,
    yearsWithData: new Set(),
    monthsWithDataByYear: new Map(),
  }
};

/* =========================
   Orchestrator
   ========================= */
export async function recompute() {
  await loadConfig();
  await refreshProjects();
  await loadCacheForSelected();
  buildMixer();
}

/* =========================
   Projects / Tags / Cache
   ========================= */
async function refreshProjects() {
  const list = await API.listProjects();
  STATE.projects = list;
  if (STATE.selectedProjects.size === 0) list.forEach(p => STATE.selectedProjects.add(p));
  renderProjectChips();
}

function renderProjectChips() {
  const box = $("#chips-projects"); if (!box) return;
  box.innerHTML = "";
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
    const btnDel  = document.createElement("button"); btnDel.textContent  = "Supprimer";
    btnArch.onclick = async (e) => { e.stopPropagation(); await API.archiveProject(name); toast("Archivé " + name); await refreshProjects(); await recompute(); };
    btnDel.onclick  = async (e) => { e.stopPropagation(); await API.deleteProject(name);  toast("Supprimé " + name); await refreshProjects(); await recompute(); };
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
      const tags  = new Set();
      const secs  = parsed.sections.filter(s => s.project === name);

      secs.forEach(s => { if (s.date) dates.add(s.date); });
      const lines = content.split("\n");
      for (let i=0;i<lines.length;i++){
        const m = rx.reTagOpenSingle.exec(lines[i]);
        if (m) { tags.add(m.groups.tag); STATE.allTags.add(m.groups.tag); }
      }
      STATE.cache.set(name, { raw: content, dates, tags, sections: secs });
    } catch(e) {}
  }

  if (STATE.selectedTags.size === 0) { STATE.allTags.forEach(t => STATE.selectedTags.add(t)); }
  recomputeCalendarDomain();
}

function renderTagChips() {
  const box = $("#chips-tags"); if (!box) return;
  box.innerHTML = "";
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

/* =========================
   Calendrier
   ========================= */
function recomputeCalendarDomain() {
  const years = new Set();
  const map = new Map();

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

  const now = new Date();
  const defY = now.getFullYear();
  const defM = now.getMonth() + 1;

  if (!STATE.cal.year) {
    STATE.cal.year = years.size ? Math.min(...Array.from(years)) : defY;
    if (years.has(defY)) STATE.cal.year = defY;
  }
  if (!STATE.cal.month) {
    const setM = map.get(STATE.cal.year) || new Set();
    STATE.cal.month = setM.size ? (setM.has(defM) ? defM : Math.min(...Array.from(setM))) : defM;
  }
}

function renderYearMonthSelectors() {
  const selY = $("#cal-year");
  const selM = $("#cal-month");
  if (!selY || !selM) return;

  const years = Array.from(STATE.cal.yearsWithData).sort((a,b)=>a-b);
  selY.innerHTML = "";
  years.forEach(y => {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    if ((STATE.cal.monthsWithDataByYear.get(y) || new Set()).size > 0) opt.classList.add("has-data");
    selY.appendChild(opt);
  });
  if (years.length) {
    if (!years.includes(STATE.cal.year)) STATE.cal.year = years[0];
    selY.value = String(STATE.cal.year);
  }
  if (STATE.cal.yearsWithData.has(STATE.cal.year)) selY.classList.add("active");
  else selY.classList.remove("active");

  selM.innerHTML = "";
  const monthNames = ["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Aoû","Sep","Oct","Nov","Déc"];
  const monthsWithData = STATE.cal.monthsWithDataByYear.get(STATE.cal.year) || new Set();
  for (let m=1;m<=12;m++){
    const opt = document.createElement("option");
    opt.value = String(m);
    opt.textContent = monthNames[m-1];
    if (monthsWithData.has(m)) opt.classList.add("has-data");
    selM.appendChild(opt);
  }
  if (monthsWithData.size > 0 && !monthsWithData.has(STATE.cal.month)) {
    STATE.cal.month = Math.min(...Array.from(monthsWithData));
  }
  selM.value = String(STATE.cal.month);

  if (monthsWithData.has(STATE.cal.month)) selM.classList.add("active");
  else selM.classList.remove("active");

  selY.onchange = () => {
    STATE.cal.year = +selY.value;
    const ms = STATE.cal.monthsWithDataByYear.get(STATE.cal.year) || new Set();
    if (!ms.has(STATE.cal.month) && ms.size) STATE.cal.month = Math.min(...Array.from(ms));
    renderYearMonthSelectors();
    renderCalendar();
    buildMixer();
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

  const daysSet = new Set();
  STATE.cache.forEach(entry => {
    entry.dates.forEach(d => {
      const p = parseDDMMYYYY(d);
      if (p && p.yyyy === year && p.mm === month) daysSet.add(d);
    });
  });

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
    };

    box.appendChild(cell);
  }
}

/* =========================
   Filtrage par tags
   ========================= */
function filterSectionByTags(text, rx, selectedTags) {
  const out = [];
  const stack = [];
  const lines = text.split("\n");
  for (let i=0;i<lines.length;i++){
    const line = lines[i];
    const mOpen = rx.reTagOpenSingle.exec(line);
    if (mOpen){
      const t=mOpen.groups.tag;
      stack.push(t);
      if (selectedTags.has(t)) out.push(line);
      continue;
    }
    const mClose = rx.reTagCloseSingle.exec(line);
    if (mClose){
      const t=mClose.groups.tagc;
      const idx=stack.lastIndexOf(t);
      if (idx!==-1) stack.splice(idx,1);
      if (selectedTags.has(t)) out.push(line);
      continue;
    }
    if (stack.length===0){ out.push(line); }
    else {
      const visible = stack.every(t => selectedTags.has(t));
      if (visible) out.push(line);
    }
  }
  return out.join("\n");
}

/* =========================
   Mixer
   ========================= */
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

  const area = $("#mixer");
  if (area) area.value = chunks.join("\n");
  renderTagChips();
  recomputeCalendarDomain();
  renderYearMonthSelectors();
  renderCalendar();

  const mixer = $("#mixer");
  const canvas = $("#mixer-gutter");
  if (mixer && canvas && window.__CONFIG) drawGutterFor(mixer, canvas, window.__CONFIG);
}

/* =========================
   Grouping preview (par projet)
   ========================= */
export function groupPreviewByProject(text) {
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

/* =========================
   Tokenize filtered preview
   - back-scan to capture nearest date above a section
   ========================= */
function tokenizePreview(filteredText, cfg){
  const tokens = [];
  const lines = filteredText.split("\n");

  const stRx   = new RegExp("^\\s*" + escReg(cfg.section.startPrefix).replace("\\{name\\}", "(.+)") + ".*$");
  const enRx   = new RegExp("^\\s*" + escReg(cfg.section.endLine) + "\\s*$");
  const dateRx = new RegExp("^\\s*" + cfg.date.linePrefix.replace("{DD/MM/YYYY}", "(\\d{2}/\\d{2}/\\d{4})") + "\\s*$");

  let currentDate = null;
  let i = 0;
  while (i < lines.length){
    const ln = lines[i];

    const md = dateRx.exec(ln);
    if (md){
      currentDate = md[1];
      tokens.push({ type: "date", date: currentDate, raw: ln });
      i++; continue;
    }

    const ms = stRx.exec(ln);
    if (ms){
      const startIdx = i;
      // collect until end
      while (i < lines.length && !enRx.test(lines[i])) i++;
      if (i < lines.length) i++; // include end
      const block = lines.slice(startIdx, i).join("\n");

      // If we don't have a currentDate, back-scan upward to find the nearest date line
      let dateForBlock = currentDate;
      if (!dateForBlock){
        for (let k=startIdx-1; k>=0; k--){
          const mdate = dateRx.exec(lines[k]);
          if (mdate){ dateForBlock = mdate[1]; break; }
        }
      }
      tokens.push({ type: "section", date: dateForBlock || null, block });
      continue;
    }

    i++;
  }
  return tokens;
}

/* =========================
   Date helpers
   ========================= */
function findDateLines(fullText, cfg){
  const dateRx = new RegExp("^\\s*" + cfg.date.linePrefix.replace("{DD/MM/YYYY}", "(\\d{2}/\\d{2}/\\d{4})") + "\\s*$");
  const lines = fullText.split("\n");
  const out = [];
  for (let i=0;i<lines.length;i++){
    const m = dateRx.exec(lines[i]);
    if (m) out.push({ idx:i, line:lines[i], date:m[1] });
  }
  return out;
}

function ensureDateLine(fullText, dateStr, cfg){
  if (!dateStr) return fullText;
  const dateLines = findDateLines(fullText, cfg);
  if (dateLines.some(d => d.date === dateStr)) return fullText;

  const lines = fullText.split("\n");
  const newLine = cfg.date.linePrefix.replace("{DD/MM/YYYY}", dateStr);

  let insertAt = lines.length;
  for (let k=0;k<dateLines.length;k++){
    const d = dateLines[k].date;
    if (cmpDate(dateStr, d) < 0) { insertAt = dateLines[k].idx; break; }
  }
  lines.splice(insertAt, 0, newLine);
  return lines.join("\n");
}

/* =========================
   upsertSectionUnderDate (scopé au “bucket” de la date)
   ========================= */
function upsertSectionUnderDate(fullText, sectionBlock, dateStr, cfg){
  const stRx = new RegExp("^\\s*" + escReg(cfg.section.startPrefix).replace("\\{name\\}", "(.+)") + ".*$");
  const enRx = new RegExp("^\\s*" + escReg(cfg.section.endLine) + "\\s*$");
  const dateRx = new RegExp("^\\s*" + cfg.date.linePrefix.replace("{DD/MM/YYYY}", "(\\d{2}/\\d{2}/\\d{4})") + "\\s*$");

  const lines = fullText.split("\n");
  const blockLines = sectionBlock.split("\n");
  const startLine  = blockLines[0];
  const endLine    = blockLines[blockLines.length - 1];

  // locate the target date bucket [dStart, dEnd)
  let dStart = -1, dEnd = lines.length;
  for (let i=0;i<lines.length;i++){
    const m = dateRx.exec(lines[i]);
    if (m && m[1] === dateStr) { dStart = i; break; }
  }
  if (dStart === -1){
    // should not happen if ensureDateLine was called
    lines.push(cfg.date.linePrefix.replace("{DD/MM/YYYY}", dateStr));
    dStart = lines.length - 1;
  }
  for (let i=dStart+1;i<lines.length;i++){
    if (dateRx.test(lines[i])) { dEnd = i; break; }
  }

  // within [dStart+1, dEnd), try to find a section with same start & end
  let sIdx = -1, eIdx = -1;
  for (let i=dStart+1; i<dEnd; i++){
    if (lines[i] === startLine){
      for (let j=i; j<dEnd; j++){
        if (lines[j] === endLine){ sIdx = i; eIdx = j; break; }
      }
      if (sIdx !== -1) break;
    }
  }

  if (sIdx !== -1){
    // replace in-place inside the bucket
    lines.splice(sIdx, eIdx - sIdx + 1, ...blockLines);
    return lines.join("\n");
  }

  // insert before dEnd, keep a blank line before if needed
  const payload = blockLines.slice();
  if (dEnd < lines.length && lines[dEnd-1]?.trim() !== "") {
    payload.unshift("");
  }
  lines.splice(dEnd, 0, ...payload);
  return lines.join("\n");
}

/* =========================
   Save flow (diff filtré vs filtré + merge FULL)
   ========================= */
export async function saveFromCompose() {
  const cfg = window.__CONFIG;
  const rx  = getRegex();

  // Dates "éditables" = dates focus si présentes, sinon toutes
  const focusedDates = new Set(STATE.selectedDates);
  const isEditableDate = (d) => focusedDates.size === 0 || focusedDates.has(d);

  const rightMap = groupPreviewByProject($("#mixer").value);

  for (const [name, rightFiltered] of rightMap.entries()) {
    // FULL actuel
    let leftRaw = "";
    try { leftRaw = (await API.getProject(name)).content || ""; } catch { leftRaw = ""; }

    // vue filtrée du FULL (pour éviter les faux diffs)
    const leftFiltered = buildComparablePreviewForProject(name);
    if (leftFiltered === rightFiltered) continue;

    await new Promise((resolve) => {
      showDiffModal(
        name + ".md",
        leftRaw,
        rightFiltered,
        async (userEditedRight) => {

          // ——— modèles structurés (ne touche pas à tes helpers existants) ———
          const fullModel   = buildFullModel(leftRaw, cfg);
          const editedModel = buildEditedModel(userEditedRight, cfg);

          // index pour retrouver vite une section du FULL par son header
          const indexFull = new Map();
          for (const [d, arr] of fullModel.entries()) {
            arr.forEach((s, idx) => indexFull.set(s.header, { date:d, idx }));
          }

          // union triée des dates (FULL ∪ EDITED)
          const allDates = new Set([...fullModel.keys(), ...editedModel.keys()]);
          const datesSorted = Array.from(allDates).sort(cmpDate);

          const resultLines = [];

          for (const dateStr of datesSorted) {
            // ⚠️ Si la date n'est pas "éditable" (pas dans le focus), on LAISSE PASSER tel quel
            if (!isEditableDate(dateStr)) {
              const sections = fullModel.get(dateStr) || [];
              if (sections.length > 0) {
                resultLines.push(cfg.date.linePrefix.replace("{DD/MM/YYYY}", dateStr));
                for (const s of sections) {
                  // petite séparation propre si nécessaire
                  if (resultLines.length && resultLines[resultLines.length - 1].trim() !== "")
                    resultLines.push("");
                  resultLines.push(...s.lines);
                }
              }
              continue; // on ne touche pas à cette date
            }

            // ——— Date éditable : appliquer la logique "tags safe" (merge non destructif) ———
            const editedSections = (editedModel.get(dateStr) || []);
            const outForDate = [];

            // a) sections venant de l'éditeur : merge si existait, sinon création
            for (const e of editedSections) {
              if (indexFull.has(e.header)) {
                const { date: oldDate, idx } = indexFull.get(e.header);
                const orig = fullModel.get(oldDate)[idx].lines;

                const merged = mergeSectionPreservingHidden(
                  orig, e.filteredLines, rx, STATE.selectedTags
                );

                outForDate.push(merged);
                fullModel.get(oldDate)[idx]._consumed = true; // ne pas réémettre ailleurs
              } else {
                // nouveau bloc
                outForDate.push(e.filteredLines);
              }
            }

            // b) sections restantes du FULL dans cette date
            const remaining = fullModel.get(dateStr) || [];
            for (const s of remaining) {
              if (s._consumed) continue;

              // si le bloc avait au moins une ligne visible avec les tags actifs → l'utilisateur l'a retiré
              // sinon (entièrement masqué) → on le conserve
              if (!sectionHasAnyVisibleLine(s.lines, rx, STATE.selectedTags)) {
                outForDate.push(s.lines);
              }
            }

            // c) émettre cette date seulement si on a au moins un bloc
            if (outForDate.length > 0) {
              resultLines.push(cfg.date.linePrefix.replace("{DD/MM/YYYY}", dateStr));
              for (const bloc of outForDate) {
                if (resultLines.length && resultLines[resultLines.length - 1].trim() !== "")
                  resultLines.push("");
                resultLines.push(...bloc);
              }
            }
          }

          const mergedText = resultLines.join("\n").replace(/\n{3,}/g, "\n\n");

          await API.saveProject(name, mergedText);
          toast(`Sauvegardé ${name}`);
          resolve();
        },
        () => resolve()
      );
    });
  }

  document.dispatchEvent(new CustomEvent("projectFilesChanged"));
}





/* =========================
   Build comparable left preview
   ========================= */
function buildComparablePreviewForProject(name) {
  const entry = STATE.cache.get(name);
  if (!entry) return "";
  const rx  = getRegex();
  const cfg = window.__CONFIG;

  const chunks = [];
  const secs = entry.sections.slice().sort((a,b)=>a._order - b._order);
  let lastDate = null;

  for (const s of secs) {
    if (STATE.selectedDates.size > 0 && (!s.date || !STATE.selectedDates.has(s.date))) continue;

    if (s.date && s.date !== lastDate) {
      chunks.push(cfg.date.linePrefix.replace("{DD/MM/YYYY}", s.date));
      lastDate = s.date;
    }
    chunks.push(filterSectionByTags(s.content, rx, STATE.selectedTags));
  }
  return chunks.join("\n");
}

/* =========================
   Init
   ========================= */
export async function initCompose() {
  const mixer  = $("#mixer");
  const canvas = $("#mixer-gutter");
  attachGutter(mixer, canvas, () => window.__CONFIG);

  await recompute();
  renderYearMonthSelectors();
  if (window.__CONFIG) drawGutterFor(mixer, canvas, window.__CONFIG);

  on(document, "projectFilesChanged", async () => {
    await recompute();
    if (window.__CONFIG) drawGutterFor(mixer, canvas, window.__CONFIG);
  });
  on(document, "configChanged", async () => {
    await recompute();
    if (window.__CONFIG) drawGutterFor(mixer, canvas, window.__CONFIG);
  });

  document.querySelectorAll('.tab[data-tab="compose"]').forEach(btn => {
    btn.addEventListener("click", () => {
      requestAnimationFrame(() => {
        if (window.__CONFIG) drawGutterFor(mixer, canvas, window.__CONFIG);
      });
    });
  });

  const btnSave = document.getElementById("btn-save-compose");
  if (btnSave) {
    btnSave.addEventListener("click", async (e) => {
      e.preventDefault();
      if (btnSave.dataset.busy === "1") return;
      try {
        btnSave.dataset.busy = "1";
        const oldLabel = btnSave.textContent;
        btnSave.textContent = "Sauvegarde…";
        await saveFromCompose();
        btnSave.textContent = oldLabel;
        btnSave.dataset.busy = "0";
      } catch (err) {
        btnSave.dataset.busy = "0";
        btnSave.textContent = "Sauvegarder";
        console.error(err);
        try { (await import("./components/toast.js")).toast("Erreur de sauvegarde"); }
        catch (_) { alert("Erreur de sauvegarde : " + (err?.message || err)); }
      }
    });
  }
}
