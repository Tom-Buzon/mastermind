import { API } from "./api.js";
export let CONFIG = null;

export async function loadConfig() {
  CONFIG = await API.getConfig();
  return CONFIG;
}

function escReg(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }

function buildRegex(){
  const datePrefix = CONFIG.date.linePrefix;     // ":::date {DD/MM/YYYY}"
  const startPrefix = CONFIG.section.startPrefix; // "__/@@ {name}"
  const endLine = CONFIG.section.endLine;         // "@@/"
  const tagOpen = CONFIG.tags.open;               // "<{name}>"
  const tagClose = CONFIG.tags.close;             // "<{name}/>"

  const datePattern  = "^" + escReg(datePrefix).replace("\\{DD/MM/YYYY\\}", "(?<date>\\d{2}/\\d{2}/\\d{4})") + "$";
  const startPattern = "^" + escReg(startPrefix).replace("\\{name\\}", "(?<name>.+)") + "(?<rest>.*)$";
  const endPattern   = "^" + escReg(endLine) + "$";

  const [toA,toB] = tagOpen.split("{name}");
  const [tcA,tcB] = tagClose.split("{name}");
  const tagOpenPattern  = escReg(toA) + "(?<tag>[^\\s<>/]+?)" + escReg(toB);
  const tagClosePattern = escReg(tcA) + "(?<tagc>[^\\s<>/]+?)" + escReg(tcB);

  return {
    reDate:  new RegExp(datePattern, "m"),
    reDateG: new RegExp(datePattern, "mg"),
    reStart: new RegExp(startPattern, "m"),
    reStartG:new RegExp(startPattern, "mg"),
    reEnd:   new RegExp(endPattern, "m"),
    reEndG:  new RegExp(endPattern, "mg"),

    // tolérance aux espaces en début/fin de ligne
    reTagOpen:        new RegExp(tagOpenPattern, "g"),
    reTagOpenSingle:  new RegExp("^\\s*" + tagOpenPattern + "\\s*$"),
    reTagClose:       new RegExp(tagClosePattern, "g"),
    reTagCloseSingle: new RegExp("^\\s*" + tagClosePattern + "\\s*$")
  };
}

export function getRegex(){ if(!CONFIG) throw new Error("CONFIG not loaded"); return buildRegex(); }

export function parseDocument(text){
  if(!CONFIG) throw new Error("CONFIG not loaded");
  const rx = buildRegex();
  const lines = text.split("\n");
  let sections = [], errors = [], warnings = [];
  let current = null, currentDate = null;

  function flush(){
    if(current){
      const content = current.lines.join("\n");
      sections.push({
        project: current.project,
        key: current.key,
        date: current.date,
        tags: Array.from(current.tags),
        content,
        segments: [],
        header: current.header,
        _order: current._order
      });
    }
    current = null;
  }

  for(let i=0;i<lines.length;i++){
    const line = lines[i];

    const mDate = rx.reDate.exec(line);
    if(mDate){ currentDate = mDate.groups.date; continue; }

    const mStart = rx.reStart.exec(line);
    if(mStart){
      const nameRest = (mStart.groups.name + (mStart.groups.rest||"")).trim();
      const parts = nameRest.split(/\s+/);
      const project = parts.shift() || "SansNom";
      const inlineTags = parts.filter(Boolean);
      current = {
        project, date: currentDate, tags: new Set(inlineTags),
        lines:[line], header: line, key: project + "@" + (currentDate||"nodate") + "#" + i, _order: i
      };
      if(!currentDate) warnings.push("Section sans date active (ligne " + (i+1) + ")");
      continue;
    }

    const mEnd = rx.reEnd.exec(line);
    if(mEnd){
      if(!current){ errors.push("Fermeture sans ouverture (ligne " + (i+1) + ")"); }
      else{ current.lines.push(line); flush(); }
      continue;
    }

    if(current){
      let mo; rx.reTagOpen.lastIndex = 0;
      while((mo = rx.reTagOpen.exec(line)) !== null){ current.tags.add(mo.groups.tag); }
      current.lines.push(line);
    }
  }
  if(current){ warnings.push("Section non fermée (fin de fichier)"); flush(); }
  return { sections, errors, warnings };
}

export function stringifySection(section){ return section.content; }

export function parseProjectFileToSections(name, text){
  const parsed = parseDocument(text);
  return parsed.sections.filter(s => s.project === name);
}
