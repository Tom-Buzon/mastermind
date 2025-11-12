// frontend/components/gutter.js
import { parseDocument } from "../parser.js";

/**
 * Branche la visualisation “arcs” sur un textarea + canvas.
 * - Écoute input/scroll/resize
 * - Redessine aussi quand l’élément change de taille ou redevient visible.
 */
export function attachGutter(textarea, canvas, getConfig) {
  const draw = () => {
    const cfg = getConfig && getConfig();
    if (!cfg) return;
    const res = parseDocument(textarea.value);
    drawGutterImpl(textarea, canvas, res, cfg);
  };

  // Double rAF : garantit un layout stable après changement d’onglet
  const redraw = () => requestAnimationFrame(() => requestAnimationFrame(draw));

  textarea.addEventListener("input", redraw);
  textarea.addEventListener("scroll", redraw);
  window.addEventListener("resize", redraw);

  // Redessine si les éléments changent de taille (tab switch, split, etc.)
  const ro = new ResizeObserver(redraw);
  ro.observe(textarea);
  ro.observe(canvas);

  // Premier rendu
  redraw();
}

/** Redessine “à la demande” (ex: après buildMixer()). */
export function drawGutterFor(textarea, canvas, cfg) {
  const res = parseDocument(textarea.value);
  drawGutterImpl(textarea, canvas, res, cfg);
}

/** ————————————————— Renderer principal ————————————————— */
function drawGutterImpl(textarea, canvas, res, cfg) {
  if (!canvas || !textarea) return;

  // === HiDPI + sizing robuste (évite width/height = 1 après tab hidden) ===
  const dpr = window.devicePixelRatio || 1;
  const rectC = canvas.getBoundingClientRect();
  const rectT = textarea.getBoundingClientRect();

  // largeur/hauteur CSS fiables (si 0 ou 1, fallback sur client/scroll)
  let wCSS = Math.floor(rectC.width);
  let hCSS = Math.floor(rectT.height);

  if (!Number.isFinite(wCSS) || wCSS < 2) {
    wCSS = Math.max(1, textarea.clientLeft + parseFloat(getComputedStyle(canvas).width) || 50);
  }
  if (!Number.isFinite(hCSS) || hCSS < 10) {
    hCSS = Math.max( textarea.clientHeight || 0, textarea.scrollHeight || 0, 1 );
  }

  canvas.width  = Math.max(1, Math.floor(wCSS * dpr));
  canvas.height = Math.max(1, Math.floor(hCSS * dpr));
  canvas.style.width  = wCSS + "px";
  canvas.style.height = hCSS + "px";

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, wCSS, hCSS);

  if (!res) return;

  // === métriques du textarea ===
  let lh = parseFloat(getComputedStyle(textarea).lineHeight);
  if (!isFinite(lh) || lh <= 0) lh = 21;
  const padTop = parseFloat(getComputedStyle(textarea).paddingTop) || 0;

  const lines   = textarea.value.split("\n");
  const yCenter = (i) => padTop + (i + 0.5) * lh - textarea.scrollTop;
  const clampY  = (y) => Math.max(0, Math.min(hCSS, y));
  const escReg  = (s) => s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");

  // === regex depuis config ===
  const dateLinePrefix = cfg.date.linePrefix.replace("{DD/MM/YYYY}", "\\d{2}/\\d{2}/\\d{4}");
  const reDateLine = new RegExp("^\\s*" + dateLinePrefix + "\\s*$");
  const reEnd      = new RegExp("^\\s*" + escReg(cfg.section.endLine) + "\\s*$");
  const [toA,toB]  = cfg.tags.open.split("{name}");
  const [tcA,tcB]  = cfg.tags.close.split("{name}");
  const reTagOpenSingle  = new RegExp("^\\s*" + escReg(toA) + "([^\\s<>/]+?)" + escReg(toB) + "\\s*$");
  const reTagCloseSingle = new RegExp("^\\s*" + escReg(tcA) + "([^\\s<>/]+?)" + escReg(tcB) + "\\s*$");

  // === positions proches du texte (à droite de la gouttière) ===
  const right   = wCSS - 6;
  const spacing = 12;
  const X_TAG     = right;
  const X_SECTION = right - spacing;
  const X_DATE    = right - spacing * 2;
  const BEND      = Math.min(Math.max(18, spacing * 1.8), 42);

  // style global
  ctx.lineWidth = 4;
  ctx.lineCap   = "round";

  // === SECTIONS (jaune) ===
  ctx.strokeStyle = "#ffd166";
  const { sections } = res;
  sections.forEach(s => {
    const startIdx = s._order;
    const endIdx   = startIdx + s.content.split("\n").length - 1;
    drawRibbonLeft(ctx, X_SECTION, clampY(yCenter(startIdx)), clampY(yCenter(endIdx)), BEND);
  });

  // === TAGS (rose) — ferment sur </tag> ou à @@/ ===
  ctx.strokeStyle = "#ff6ea8";
  sections.forEach(s => {
    const startIdx = s._order;
    const endIdx   = startIdx + s.content.split("\n").length - 1;
    const stack = [];
    for (let i = startIdx; i <= endIdx; i++) {
      const line = lines[i];
      const mO = reTagOpenSingle.exec(line);
      if (mO) { stack.push({ tag: mO[1], i }); continue; }
      const mC = reTagCloseSingle.exec(line);
      if (mC) {
        const t = mC[1];
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k].tag === t) {
            const open = stack[k].i; stack.splice(k, 1);
            drawRibbonLeft(ctx, X_TAG, clampY(yCenter(open)), clampY(yCenter(i)), BEND);
            break;
          }
        }
        continue;
      }
      if (reEnd.test(line) && stack.length) {
        const yClose = clampY(yCenter(i));
        while (stack.length) {
          const open = stack.pop();
          drawRibbonLeft(ctx, X_TAG, clampY(yCenter(open.i)), yClose, BEND);
        }
      }
    }
    // garde-fou fin de section
    if (stack.length) {
      const yClose = clampY(yCenter(endIdx));
      while (stack.length) {
        const open = stack.pop();
        drawRibbonLeft(ctx, X_TAG, clampY(yCenter(open.i)), yClose, BEND);
      }
    }
  });

  // === DATES (bleu) — jusqu’au dernier @@/ avant la date suivante ===
  ctx.strokeStyle = "#6ecbff";
  const dateIdx = [];
  for (let i = 0; i < lines.length; i++) if (reDateLine.test(lines[i])) dateIdx.push(i);
  for (let d = 0; d < dateIdx.length; d++) {
    const startLine = dateIdx[d];
    const stop = (d < dateIdx.length - 1) ? dateIdx[d + 1] : lines.length;

    // borne au dernier contenu pour éviter la “traînée” sur lignes vides
    let lastNonEmpty = lines.length - 1;
    while (lastNonEmpty > 0 && lines[lastNonEmpty].trim() === "") lastNonEmpty--;

    let lastClose = null;
    for (let i = startLine + 1; i < stop; i++) if (reEnd.test(lines[i])) lastClose = i;
    const endLine = (lastClose !== null) ? lastClose : Math.min(stop - 1, lastNonEmpty);

    drawRibbonLeft(ctx, X_DATE, clampY(yCenter(startLine)), clampY(yCenter(endLine)), BEND);
  }
}

/** Courbe à gauche (ruban) */
function drawRibbonLeft(ctx, x, y1, y2, bend) {
  if (y2 < y1) { const t = y1; y1 = y2; y2 = t; }
  const cx = x - bend;
  ctx.beginPath();
  ctx.moveTo(x, y1);
  ctx.bezierCurveTo(cx, y1, cx, y2, x, y2);
  ctx.stroke();
}
