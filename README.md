Mastermind

🔰 Quick Start

Serve the folder (any static server):

# Python
python -m http.server 15173 --directory frontend
# or Node http-server
npx http-server ./frontend -p 15173


Open http://127.0.0.1:15173.

🍵 What is it ?

A lightweight, local, file-based notes system optimised for structured daily logs, with a live gutter visualiser (arcs for dates/sections/tags), a Compose mixer that merges content across projects, and a minimal, modern dark/light UI.

Built with plain ES modules (no framework, no build step). Runs from any static HTTP server.

✨ Features

Two work modes

Edit: write in a single document with live parsing, analysis badges, and neon arcs.

Compose: aggregate sections across projects; filter by project, tags, dates (day picker + year/month selectors); preview; save back by project with a diff modal.

Neon gutter arcs

Blue = date ranges (:::date DD/MM/YYYY → last section before next date)

Yellow = section ranges (from section start to end)

Pink = tag spans (<tag> ... <tag/>) nested inside sections

Configurable grammar (no rebuild):

date.linePrefix

section.startPrefix, section.endLine

tags.open, tags.close

UI presets updated at runtime after save

Project management

List, archive, delete projects; save changes with a review diff

Export

Export current editor content to a flat file (see Export section)

Dark/Light

Auto respects OS; manual toggle; persisted to localStorage

🗂 Directory & File Structure
frontend/
  index.html
  styles.css
  main.js               # entrypoint; boots Edit + Compose; theme, tabs, events
  compose.js            # Compose page logic; chips, calendar, mixer, save
  parser.js             # Grammar + parseDocument() + getRegex()
  exporter.js           # Export from Edit
  api.js                # File ops and config bridge
  utils.js              # $, on, $, $all, todayDDMMYYYY, helpers
  components/
    gutter.js           # Shared neon arcs renderer (textarea + canvas)
    toast.js            # Small toast utility
    modal.js            # Diff modal (confirm & apply)


Data: the app expects Markdown-like .md project files and a JSON config.
The exact path is handled by api.js (and can be extended to support a custom data folder).

🔰 Quick Start

Serve the folder (any static server):

# Python
python -m http.server 15173 --directory frontend
# or Node http-server
npx http-server ./frontend -p 15173


Open http://127.0.0.1:15173.

The app uses native ES modules; opening index.html directly from the filesystem will be blocked by the browser. Use a server.

🧩 Grammar (Configurable)

Open Config to edit the live grammar. Defaults:

{
  "date": { "linePrefix": ":::date {DD/MM/YYYY}" },
  "section": { "startPrefix": "__/@@ {name}", "endLine": "@@/" },
  "tags": { "open": "<{name}>", "close": "<{name}/>" }
}

Examples
:::date 12/11/2025

__/@@ Mon_Projet
  <tag>
  Some content...
  <tag/>
@@/


A date line starts a blue arc to the last section end before the next date.

A section begins with section.startPrefix and ends at section.endLine.

Tags open/close inside a section. Pink arcs pair matching <tag> ... <tag/>.
Nested tags are supported; arcs close at section end if needed.

🧠 How the Gutter Works

components/gutter.js is a shared renderer:

Binds to a textarea + canvas

Uses device-pixel-ratio aware sizing

Redraws on input, scroll, resize, tab switch (via drawGutterFor), and element size changes (ResizeObserver)

Computes y-positions from computed line height; arcs are bezier curves with a gentle left bend

Both Edit and Compose re-use the same component.

🧭 Compose Mixer

Projects: toggle chips to include/exclude projects

Tags: toggle chips; mixer keeps only tag spans that pass the filter (with nested logic)

Dates:

Year and month selectors show only periods present in data (highlighted)

Day grid shows clickable days with content; selected days are sticky

Save:

Groups generated preview per project

Shows a diff modal and writes back only changed files

Emits projectFilesChanged to refresh Compose lists

⌨️ Useful UI Bits

Top-bar tabs: “Éditer” / “Compose”

Edit toolbar buttons:

+ Date → inserts today’s date line

+ Section → inserts a section scaffold and places the caret inside

+ Tag, Table, Checklist → handy snippets

Theme: sun/moon button toggles and persists

🔧 Developer Notes
Data/Config API

api.js should implement (or mock) these functions:

listProjects() : Promise<string[]>

getProject(name) : Promise<{content:string}>

saveProject(name, text) : Promise<void>

archiveProject(name) : Promise<void>

deleteProject(name) : Promise<void>

getConfig() : Promise<Config>

saveConfig(cfg, rewriteFiles:boolean, prevCfg) : Promise<void>

If you add data folder selection later, expose e.g.:

getDataRoot() : Promise<string>

setDataRoot(path) : Promise<void>

…and have getConfig()/saveConfig() include the path.

Events

document.dispatchEvent(new CustomEvent("projectFilesChanged"))
→ Compose reloads projects & cache.

document.dispatchEvent(new CustomEvent("configChanged"))
→ Both Edit and Compose reload the grammar and redraw gutters.

Redraw safety

On tab switches, main.js calls drawGutterFor() for both editors to ensure canvases re-size after layout changes.

gutter.js also listens to element resize events.

📦 Export

Edit → Export writes the current editor buffer to a file (see exporter.js).

After exporting a new project file, Compose will show it automatically on the next projectFilesChanged (the Export action should emit it if the file list actually changed).

🧱 Styling & Theming

Design tokens in :root; dark/light overrides with body[data-theme]

Accent colours:

--accent-blue (dates)

--accent-yellow (sections)

--accent-pink (tags)

Gutter spacing:

--gutter-w (canvas width)

--gutter-gap (padding between canvas and text)

🗺 Roadmap (suggested)

Data root selector in Config (with Archive following the root)

Global search (by tag/date/content)

Keyboard shortcuts for snippets

Per-project colour coding

Save checkpoints / versions

📄 Licence

MIT — 