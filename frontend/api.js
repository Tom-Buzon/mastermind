async function http(method, url, data) {
  const res = await fetch(url, {
    method,
    headers: {"Content-Type": "application/json", "Cache-Control": "no-store"},
    body: data ? JSON.stringify(data) : undefined,
    cache: "no-store"
  });
  if (!res.ok) throw new Error("HTTP " + res.status + " " + (await res.text()));
  return res.json();
}
export const API = {
  async listProjects() { const r = await http("GET", "/api/projects"); return r.projects || []; },
  async getProject(name) { return http("GET", "/api/project/" + encodeURIComponent(name)); },
  async saveProject(name, content) { return http("POST", "/api/project/" + encodeURIComponent(name), {content}); },
  async archiveProject(name) { return http("POST", "/api/project/" + encodeURIComponent(name) + "/archive", {}); },
  async deleteProject(name) { return http("DELETE", "/api/project/" + encodeURIComponent(name)); },
  async getConfig() { return http("GET", "/api/config"); },
  async saveConfig(config, applyMigration, previousConfig) { return http("POST", "/api/config", {config, applyMigration, previousConfig}); }
};
