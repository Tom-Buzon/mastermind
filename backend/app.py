# -*- coding: utf-8 -*-
import os, io, re, json, glob, webbrowser
from datetime import datetime
from flask import Flask, send_from_directory, request, jsonify, abort

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(APP_ROOT, "frontend")
DATA_DIR = os.path.join(APP_ROOT, "data")
ARCHIVE_DIR = os.path.join(DATA_DIR, "archive")
CONFIG_PATH = os.path.join(FRONTEND_DIR, "config.json")
PORT = 15173

app = Flask(__name__, static_folder=None)

def _nocache(resp):
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

def ensure_dirs():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(ARCHIVE_DIR, exist_ok=True)

def list_projects():
    ensure_dirs()
    files = sorted([os.path.splitext(os.path.basename(p))[0] for p in glob.glob(os.path.join(DATA_DIR, "*.md"))])
    return files

def read_text(path):
    with io.open(path, "r", encoding="utf-8", newline=None) as f:
        return f.read()

def write_text(path, content):
    content = content.replace("\r\n", "\n").replace("\r", "\n")
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)

@app.after_request
def add_headers(resp):
    return _nocache(resp)

@app.route("/", methods=["GET"])
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")

@app.route("/<path:path>", methods=["GET"])
def assets(path):
    full = os.path.join(FRONTEND_DIR, path)
    if not os.path.abspath(full).startswith(os.path.abspath(FRONTEND_DIR)):
        abort(403)
    if os.path.isfile(full):
        return send_from_directory(FRONTEND_DIR, path)
    abort(404)

@app.route("/api/projects", methods=["GET"])
def api_projects():
    return jsonify({"projects": list_projects()})

@app.route("/api/project/<name>", methods=["GET"])
def api_project_get(name):
    ensure_dirs()
    safe = re.sub(r"[^A-Za-z0-9_\- ]", "_", name).strip()
    path = os.path.join(DATA_DIR, f"{safe}.md")
    if not os.path.exists(path):
        abort(404)
    return jsonify({"name": safe, "content": read_text(path)})

@app.route("/api/project/<name>", methods=["POST"])
def api_project_post(name):
    ensure_dirs()
    body = request.get_json(silent=True) or {}
    content = body.get("content", "")
    safe = re.sub(r"[^A-Za-z0-9_\- ]", "_", name).strip()
    path = os.path.join(DATA_DIR, f"{safe}.md")
    write_text(path, content)
    return jsonify({"ok": True})

@app.route("/api/project/<name>/archive", methods=["POST"])
def api_project_archive(name):
    ensure_dirs()
    safe = re.sub(r"[^A-Za-z0-9_\- ]", "_", name).strip()
    src = os.path.join(DATA_DIR, f"{safe}.md")
    if not os.path.exists(src):
        abort(404)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    dst = os.path.join(ARCHIVE_DIR, f"{safe}-{ts}.md")
    import shutil
    shutil.move(src, dst)
    return jsonify({"ok": True, "archived": os.path.basename(dst)})

@app.route("/api/project/<name>", methods=["DELETE"])
def api_project_delete(name):
    ensure_dirs()
    safe = re.sub(r"[^A-Za-z0-9_\- ]", "_", name).strip()
    src = os.path.join(DATA_DIR, f"{safe}.md")
    if not os.path.exists(src):
        abort(404)
    os.remove(src)
    return jsonify({"ok": True})

@app.route("/api/config", methods=["GET", "POST"])
def api_config():
    ensure_dirs()
    if request.method == "GET":
        if not os.path.exists(CONFIG_PATH):
            default = {
                "date": {"linePrefix": ":::date {DD/MM/YYYY}"},
                "section": {"startPrefix": "__/@@ {name}", "endLine": "@@/"},
                "tags": {"open": "<{name}>", "close": "<{name}/>"}}
            with open(CONFIG_PATH, "w", encoding="utf-8", newline="\n") as f:
                json.dump(default, f, indent=2)
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return jsonify(json.load(f))

    body = request.get_json(silent=True) or {}
    new_cfg = body.get("config")
    apply_migration = bool(body.get("applyMigration"))
    prev_cfg = body.get("previousConfig")
    if not isinstance(new_cfg, dict):
        abort(400)

    with open(CONFIG_PATH, "w", encoding="utf-8", newline="\n") as f:
        json.dump(new_cfg, f, indent=2)

    migrated = []
    if apply_migration and isinstance(prev_cfg, dict):
        # Basic literal migration for dates/section/tag tokens
        def esc(s): return re.escape(s)
        old_date = prev_cfg.get("date", {}).get("linePrefix", ":::date {DD/MM/YYYY}")
        new_date = new_cfg.get("date", {}).get("linePrefix", ":::date {DD/MM/YYYY}")
        old_start = prev_cfg.get("section", {}).get("startPrefix", "__/@@ {name}")
        new_start = new_cfg.get("section", {}).get("startPrefix", "__/@@ {name}")
        old_end = prev_cfg.get("section", {}).get("endLine", "@@/")
        new_end = new_cfg.get("section", {}).get("endLine", "@@/")
        old_open = prev_cfg.get("tags", {}).get("open", "<{name}>")
        new_open = new_cfg.get("tags", {}).get("open", "<{name}>")
        old_close = prev_cfg.get("tags", {}).get("close", "<{name}/>")
        new_close = new_cfg.get("tags", {}).get("close", "<{name}/>")

        pat_date = re.compile("^" + esc(old_date).replace(r"\{DD/MM/YYYY\}", r"\d{2}/\d{2}/\d{4}") + "$", re.M)
        def rep_date(m):
            line = m.group(0)
            mdate = re.search(r"(\d{2}/\d{2}/\d{4})", line)
            dval = mdate.group(1) if mdate else "{DD/MM/YYYY}"
            return new_date.replace("{DD/MM/YYYY}", dval)

        # tag open/close conversion
        oA, oB = old_open.split("{name}")
        nOA, nOB = new_open.split("{name}")
        cA, cB = old_close.split("{name}")
        nCA, nCB = new_close.split("{name}")
        pat_open = re.compile(re.escape(oA) + r"(.+?)" + re.escape(oB))
        pat_close = re.compile(re.escape(cA) + r"(.+?)" + re.escape(cB))

        pat_start = re.compile("^" + re.escape(old_start).replace(r"\{name\}", r"(.+)") + ".*$", re.M)
        pat_end = re.compile("^" + re.escape(old_end) + "$", re.M)

        for proj in list_projects():
          path = os.path.join(DATA_DIR, proj + ".md")
          txt = read_text(path)
          txt = pat_date.sub(rep_date, txt)
          def rep_start(m):
            name_rest = m.group(1)
            return new_start.replace("{name}", name_rest)
          txt = pat_start.sub(rep_start, txt)
          txt = pat_end.sub(new_end, txt)
          txt = pat_open.sub(lambda m: nOA + m.group(1) + nOB, txt)
          txt = pat_close.sub(lambda m: nCA + m.group(1) + nCB, txt)
          write_text(path, txt)
          migrated.append(proj)

    return jsonify({"ok": True, "migrated": migrated})

def open_browser():
    try:
        webbrowser.open_new(f"http://127.0.0.1:{PORT}/")
    except Exception:
        pass

if __name__ == "__main__":
    ensure_dirs()
    from threading import Timer
    Timer(0.7, open_browser).start()
    app.run(host="127.0.0.1", port=PORT, debug=False)
