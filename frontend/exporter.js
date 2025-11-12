import { API } from "./api.js";
import { loadConfig, parseDocument } from "./parser.js";
import { toast } from "./components/toast.js";

// Export multi-projets / multi-dates en une seule passe
export async function exportFromEditor(editorText) {
  await loadConfig();
  const cfg = await API.getConfig();
  const { sections } = parseDocument(editorText);
  if (sections.length === 0) { toast("Aucune section détectée"); return; }

  const byProject = new Map();
  sections.forEach(s => { if (!byProject.has(s.project)) byProject.set(s.project, []); byProject.get(s.project).push(s); });

  for (const [project, projSections] of byProject.entries()) {
    let currentText = "";
    try { const p = await API.getProject(project); currentText = p.content || ""; } catch(e){ currentText = ""; }
    let updated = currentText;

    for (const s of projSections) {
      const date = s.date || null; if (!date) continue;
      const dateLine = cfg.date.linePrefix.replace("{DD/MM/YYYY}", date);
      const lines = updated.split("\n");
      const positions = [];
      for (let i=0;i<lines.length;i++){ if (lines[i].trim() === dateLine) positions.push(i); }
      if (positions.length === 0) {
        updated = (updated ? updated + "\n" : "") + dateLine + "\n" + s.content + "\n";
      } else {
        const beforeToken = cfg.date.linePrefix.split("{DD/MM/YYYY}")[0];
        const lastPos = positions[positions.length - 1];
        let insertIdx = lines.length;
        for (let i=lastPos + 1; i<lines.length; i++) {
          if (lines[i].startsWith(beforeToken)) { insertIdx = i; break; }
        }
        const before = lines.slice(0, insertIdx).join("\n");
        const after  = lines.slice(insertIdx).join("\n");
        updated = before + "\n" + s.content + (after ? "\n" + after : "\n");
      }
    }

    if (updated !== currentText) {
      await API.saveProject(project, updated);
      toast("Export mis à jour : " + project);
      document.dispatchEvent(new CustomEvent("projectFilesChanged"));
    }
  }
}
