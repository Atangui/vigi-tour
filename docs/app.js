"use strict";

/* ===================== Données de référence ===================== */
const ICON = {
  today: "M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z",
  late: "M12 4l9 16H3zM12 10v4M12 17v.5",
  all: "M4 13h4l2 3h4l2-3h4M4 13l2.5-7h11L20 13v5H4z",
  todo: "M8.5 12.5l2.5 2.5 5-5M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z",
  fwd: "M14 6l6 6-6 6M20 12H9a5 5 0 0 0-5 5v1",
  pen: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  wait: "M7 3h10M7 21h10M8 3c0 5 8 6 8 9s-8 4-8 9M16 3c0 5-8 6-8 9",
  review: "M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4M12 8v4l3 2",
  likely: "M4 12l5 5L20 6M4 18h7",
  snooze: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z",
  info: "M12 11v6M12 7.5v.5M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z",
  done: "M4 7h16v3H4zM6 10v9h12v-9M10 14h4",
  check: "M5 12.5l4.5 4.5L19 7",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  hide: "M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 5 9 7a10.6 10.6 0 0 1-2.3 3.2M6.2 6.2C4 7.6 3 10.2 3 12c0 2 4 7 9 7a9 9 0 0 0 4.2-1",
};
const MAIN_FOLDERS = ["Boîte de réception", "Éléments envoyés"];
const folderTag = (f) => f && !MAIN_FOLDERS.includes(f)
  ? `<span class="tag fold" title="Dossier Outlook">${svg("folder")}${esc(f.startsWith("id:") ? "Autre dossier" : f.split(" / ").pop())}</span>` : "";
const VIEWS = [
  { head: "Focus" },
  { id: "focus", label: "Aujourd’hui", icon: "today", sub: "Retards, échéances sous 3 jours et priorités hautes" },
  { id: "retard", label: "En retard", icon: "late", badge: "hot", sub: "Échéance dépassée" },
  { head: "Tâches" },
  { id: "tout", label: "Toutes", icon: "all", sub: "Toutes les tâches ouvertes" },
  { id: "a_faire", label: "À faire", icon: "todo", sub: "Les demandes qui t’attendent" },
  { id: "a_transferer", label: "À transférer", icon: "fwd", sub: "À confier à la bonne personne" },
  { id: "engagement", label: "Mes engagements", icon: "pen", sub: "Ce que tu as promis" },
  { id: "en_attente", label: "En attente", icon: "wait", sub: "Ce que tu attends des autres" },
  { head: "Nettoyage" },
  { id: "revue", label: "Revue de l’historique", icon: "review", badge: "acc", sub: "Demandes reçues avant Vigie Tour, à trier une seule fois" },
  { id: "probables", label: "Probablement traité", icon: "likely", sub: "Anciennes demandes jamais relancées depuis 3 semaines" },
  { id: "reportes", label: "Reportées", icon: "snooze", sub: "Masquées jusqu’à leur date de rappel" },
  { id: "info", label: "À trier", icon: "info", sub: "Pour info, ou à confirmer d’un clic" },
  { id: "fait", label: "Terminées", icon: "done", sub: "Traitées ou ignorées" },
];
const KIND = { a_faire: "À faire", a_transferer: "À transférer", engagement: "Engagement", en_attente: "En attente", info: "Info" };
const STATUS = { a_faire: "À faire", en_cours: "En cours", en_attente: "En attente", delegue: "Délégué", fait: "Fait", ignore: "Ignoré" };
const GROUPS = [["late", "En retard"], ["today", "Aujourd’hui"], ["tomorrow", "Demain"], ["week", "Cette semaine"], ["later", "Plus tard"], ["none", "Sans échéance"]];

/* ===================== État ===================== */
const S = {
  view: store("mp.view") || "focus", q: "", lot: null, only: null, tasks: [], sel: null, st: null, stKey: "",
  dashHidden: store("mp.dash") === "0", review: null,
};
const $ = (s, el = document) => el.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[name]}"/></svg>`;
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  return r.json();
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2400); }
function copy(text, msg) { navigator.clipboard.writeText(text || "").then(() => toast(msg || "Copié"), () => toast("Copie impossible")); }

/* ===================== Dates ===================== */
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => iso(new Date());
function addDays(n, h = 9) { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return d; }
function localIso(d) { return `${iso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function dueDate(t) { return t.deadline ? new Date(t.deadline + "T18:00:00") : null; }   // une échéance « jour » = fin de journée
function group(t) {
  if (!t.deadline) return "none";
  const diff = Math.round((new Date(t.deadline + "T12:00") - new Date(todayIso() + "T12:00")) / 864e5);
  return diff < 0 ? "late" : diff === 0 ? "today" : diff === 1 ? "tomorrow" : diff <= 7 ? "week" : "later";
}
function whenLabel(t) {
  if (t.status === "fait") return "Fait";
  if (!t.deadline) return "";
  const diff = Math.round((new Date(t.deadline + "T12:00") - new Date(todayIso() + "T12:00")) / 864e5);
  if (diff < 0) return `Retard · ${-diff} j`;
  if (diff === 0) { const ms = dueDate(t) - Date.now(); return ms > 0 ? `Dans ${Math.floor(ms / 36e5)} h ${pad(Math.floor(ms / 6e4) % 60)}` : "Aujourd’hui"; }
  if (diff === 1) return "Demain";
  return new Date(t.deadline + "T12:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}
const longDate = (s) => s ? new Date(s.length > 10 ? s : s + "T12:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : "Aucune";
const fmtDT = (s) => s ? new Date(s).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const initials = (n) => String(n || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

/* ===================== Thème ===================== */
function applyTheme(theme, mode) {
  const el = document.documentElement;
  if (theme) { el.dataset.theme = theme; store("mp.theme", theme); }
  if (mode) { el.dataset.mode = mode; store("mp.mode", mode); }
  document.querySelectorAll("[data-theme-btn]").forEach((b) => b.classList.toggle("on", b.dataset.themeBtn === el.dataset.theme));
  renderDash();
  S.labKey = S.labPipe = S.labSig = null;
  renderLab(S.st);
}

/* ===================== Décor laboratoire (thème Spatial) ===================== */
const labOn = () => document.documentElement.dataset.theme === "spatial" && document.documentElement.dataset.lab === "on";
const RAIN_CHARS = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ0123456789ΣΔλπ<>=+*#";
function buildRain(el, cols, len) {
  if (!el || el.childElementCount) return;
  let html = "";
  for (let c = 0; c < cols; c++) {
    let col = "";
    for (let i = 0; i < len; i++) col += RAIN_CHARS[(Math.random() * RAIN_CHARS.length) | 0] + (i < len - 1 ? "\n" : "");
    html += `<i style="animation-duration:${(5 + Math.random() * 6).toFixed(1)}s;animation-delay:-${(Math.random() * 9).toFixed(1)}s">${col}</i>`;
  }
  el.innerHTML = html;
}
const logHtml = (lines, num) => lines.map((l) => `<div>${num ? String(l.n % 1000).padStart(3, "0") + " " : ""}<b>${esc(l.verb)}</b>${esc(l.text)}</div>`).join("");
function sigPath(vals) {
  const n = Math.max(2, vals.length), max = Math.max(1, ...vals);
  let d = "";
  for (const off of [0, 200]) vals.forEach((v, i) => { d += (d ? "L" : "M") + (off + (i * 200) / (n - 1)).toFixed(1) + " " + (36 - (v / max) * 30).toFixed(1); });
  return d;
}
function renderLab(st) {
  if (!labOn() || !st) return;
  buildRain($("#rain"), 16, 26);
  buildRain($("#conRain"), 18, 22);
  // Terminaux : le vrai journal du moteur (redessiné seulement quand une ligne arrive, pour ne pas couper l'animation)
  const log = st.log || [];
  const last = log.length ? log[log.length - 1].n : 0;
  if (last !== S.labKey) {
    S.labKey = last;
    const side = log.slice(-10), con = log.slice(-18);
    $("#sideTerm").innerHTML = `<div class="term-head"><span>Moteur</span><span>${st.llm && st.llm.ok ? "IA locale" : "règles"}</span></div>` +
      `<div class="term-log"><div class="scroll">${logHtml(side)}${logHtml(side)}</div></div><div>&gt; <span class="cursor">█</span></div>`;
    $("#conLog").innerHTML = logHtml(con, true) + logHtml(con, true);
  }
  // Cascade : un étage par moteur, une cellule par tâche créée aujourd'hui
  const today = st.today || {}, llmOk = st.llm && st.llm.ok, calls = (st.usage_today || {}).calls || 0;
  const cells = (n, cls, run) => Array.from({ length: 10 }, (_, i) => `<i class="${i < Math.min(n, 10) ? cls + (run && i === Math.min(n, 10) - 1 ? " run" : "") : ""}"></i>`).join("");
  const scan = st.last_scan ? new Date(st.last_scan).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—";
  const stages = [
    ["01 capture", cells(10, "on", st.busy), scan],
    ["02 règles", cells(today.local || 0, "on", false), `${today.local || 0} auj.`],
    ["03 ia locale", cells(Math.max(today.ia || 0, st.llm_reading ? 1 : 0), "gr", st.llm_reading),
      !llmOk ? "arrêtée" : st.llm_reading ? "lecture…" : st.llm_pending ? `${st.llm_pending} en file` : "prête"],
    ["04 à trier", cells(st.counts.info || 0, "wa", false), `${st.counts.info || 0}`],
    ["05 ✦ claude", cells(calls, "vi", false), "sur clic"],
  ];
  const pipe = `<div class="lab-cap"><span>Cascade / dispatch</span><span>5 étages</span></div>` +
    stages.map((x) => `<div class="pipe"><span class="nm">${x[0]}</span><span class="cells" aria-hidden="true">${x[1]}</span><span class="nt">${x[2]}</span></div>`).join("") +
    `<div class="lab-cap" style="margin-top:auto;font-size:9.5px"><span>tâches créées aujourd’hui, par étage</span></div>`;
  if (pipe !== S.labPipe) { S.labPipe = pipe; $("#conPipe").innerHTML = pipe; }
  // Signal : reçus, tâches créées, tâches terminées sur 14 jours
  const sg = st.signal || { received: [], created: [], done: [] }, sum = (a) => a.reduce((x, y) => x + y, 0);
  const sig = `<div class="lab-cap"><span>Signal / 14 jours</span><span>${sum(sg.received)} mails</span></div><div class="sig">` +
    [["reçus", sg.received, "var(--muted)", ""], ["tâches", sg.created, "var(--accent2)", "s2"], ["traitées", sg.done, "var(--accent)", "s3"]]
      .map(([l, v, c, k]) => `<span class="lab-cap" style="font-size:9.5px;color:${c}">${l}</span><svg viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true"><path class="${k}" d="${sigPath(v)}" style="stroke:${c}"></path></svg>`).join("") + `</div>`;
  if (sig !== S.labSig) { S.labSig = sig; $("#conSignal").innerHTML = sig; }
  $("#conLive").textContent = `● en ligne · règles 0,01 s · ia locale ${!llmOk ? "arrêtée" : st.llm_reading ? "en lecture" : "prête"} · ${calls} appel${calls > 1 ? "s" : ""} Claude aujourd’hui`;
}

/* ===================== Navigation & état serveur ===================== */
function renderNav() {
  const c = S.st ? S.st.counts : {};
  $("#nav").innerHTML = VIEWS.map((v) => v.head
    ? `<div class="navhead">${v.head}</div>`
    : `<button class="nav ${v.id === S.view ? "on" : ""}" data-view="${v.id}" title="${v.label}">${svg(v.icon)}<span>${v.label}</span>` +
      `<span class="cnt ${v.badge && c[v.id] ? v.badge : ""}">${c[v.id] ?? ""}</span></button>`).join("");
  $("#nav").querySelectorAll("[data-view]").forEach((b) => b.onclick = () => setView(b.dataset.view));
}
function setView(id, opts = {}) {
  S.view = id; S.lot = opts.lot ?? null; S.only = null; S.sel = null; store("mp.view", id);
  if (!opts.keepQuery) { S.q = ""; $("#cmd").value = ""; }
  renderNav(); loadTasks();
  if (shellMode()) $(".content").scrollTop = 0;
  else window.scrollTo({ top: S.dashHidden ? 0 : $(".content").offsetTop - 20, behavior: "smooth" });
}
/* Disposition « application » : barre latérale et briefing fixes, seules la liste et le détail défilent */
const shellMode = () => matchMedia("(min-width: 1001px) and (min-height: 620px)").matches;
function toggleDash(show = S.dashHidden) {
  S.dashHidden = !show; store("mp.dash", S.dashHidden ? "0" : "1");
  renderDash(); renderTools(); syncShellButtons();
}
function toggleSide() {
  const mini = document.documentElement.classList.toggle("side-mini");
  store("mp.side", mini ? "mini" : "full");
  syncShellButtons();
  setTimeout(() => { applyLayout(); }, 260);  // le globe et la largeur du détail suivent la nouvelle place
}
function syncShellButtons() {
  const b = $("#dashBtn");
  b.setAttribute("aria-pressed", String(!S.dashHidden));
  b.querySelector(".lbl").textContent = S.dashHidden ? "Afficher le briefing" : "Briefing";
  const mini = document.documentElement.classList.contains("side-mini");
  $("#sideToggle").setAttribute("aria-label", mini ? "Déplier la barre latérale" : "Replier la barre latérale");
}
async function refreshState() {
  let st;
  try { st = await api("/api/state"); } catch (e) { $("#status").innerHTML = `<span class="live ko"></span>Serveur injoignable`; return; }
  S.st = st;
  const key = JSON.stringify(st.counts) + st.last_analysis;
  if (key !== S.stKey) { S.stKey = key; renderNav(); renderDash(); if (!document.activeElement || document.activeElement.tagName !== "TEXTAREA") loadTasks(true); }
  else renderDash();
  renderLab(st);
  $("#status").innerHTML =
    `<div><span class="live ${st.busy ? "busy" : ""}"></span>${esc(st.busy ? st.step : engineLine(st))}</div>` +
    `<div>${st.messages} mails · ${st.threads} conversations</div>` +
    `<div>Lu ${st.last_scan ? fmtDT(st.last_scan) : "—"}</div>`;
  $("#banner").classList.add("hidden");  // l'outil ne dépend plus de Claude : rien ne bloque
}
const SOURCE = { local: ["Règles", "Premier tri instantané (règles + apprentissage), en attente de lecture par l’IA locale"], ia: ["IA locale", "Lue par l’IA locale, sur ce PC"], claude: ["✦ Claude", "Analysée par Claude"] };
function engineLine(st) {
  const l = st.llm || {};
  if (l.ok && st.llm_pending) return `IA locale : ${st.llm_pending} conversation${st.llm_pending > 1 ? "s" : ""} à relire`;
  return l.ok ? "IA locale active · 0 jeton" : "Analyse locale active · 0 jeton";
}
async function syncNow() {
  toast("Synchronisation…");
  const r = await api("/api/sync", {});
  toast(r.new ? `${r.new} nouveau${r.new > 1 ? "x" : ""} mail${r.new > 1 ? "s" : ""} · ${r.tasks} tâche${r.tasks > 1 ? "s" : ""} créée${r.tasks > 1 ? "s" : ""}` : "À jour : aucun nouveau mail");
  refreshState();
}
async function askClaude(btn, url, body) {
  const label = btn.innerHTML;
  btn.disabled = true; btn.textContent = "Claude réfléchit…";
  let r;
  try { r = await api(url, body); } catch (e) { r = { ok: false, message: "Serveur injoignable" }; }
  btn.disabled = false; btn.innerHTML = label;
  toast(r.message);
  if (!r.ok) return;
  await loadTasks(true);
  if (r.ids && r.ids.length) S.sel = S.tasks.find((t) => r.ids.includes(t.id))?.id ?? S.sel;
  renderList(); renderDetail(); refreshState();
}

/* ===================== Briefing ===================== */
function renderDash() {
  const st = S.st; if (!st) return;
  $("#dash").classList.toggle("hidden", S.dashHidden);
  const c = st.counts, now = new Date(), bento = document.documentElement.dataset.theme === "bento";
  $("#briefDate").textContent = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) + " · " + now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  $("#briefTitle").textContent = bento ? String(c.focus) : `${now.getHours() < 18 ? "Bonjour" : "Bonsoir"} ${st.me}.`;
  $("#briefText").innerHTML = (bento ? "tâches à traiter maintenant. " : `${c.focus} tâches à traiter maintenant, `) +
    (c.retard ? `dont <span class="hot">${c.retard} en retard</span>. ` : "aucune en retard. ") +
    `<b>${c.en_attente}</b> attente${c.en_attente > 1 ? "s" : ""} envers les autres` +
    (c.revue ? `, et <b>${c.revue}</b> anciennes demandes à revoir une fois.` : ".");
  const pills = [["retard", c.retard, "En retard", "hot"], ["focus", c.focus, "Aujourd’hui", ""], ["en_attente", c.en_attente, "En attente", ""], ["revue", c.revue, "À revoir", "acc"]];
  $("#briefPills").innerHTML = pills.map((p) => `<button class="pill ${p[3]}" data-go="${p[0]}"><b>${p[1]}</b><span>${p[2]}</span></button>`).join("");
  $("#briefPills").querySelectorAll("[data-go]").forEach((b) => b.onclick = () => setView(b.dataset.go));
  const total = c.focus + st.done_today;
  $("#dayDots").innerHTML = Array.from({ length: Math.min(total, 40) }, (_, i) => `<i class="${i < st.done_today ? "on" : ""}"></i>`).join("");
  $("#dayTxt").textContent = `${st.done_today} / ${total} traitées aujourd’hui`;
  // Prochaine échéance
  S.next = st.next;
  $("#nextTitle").textContent = st.next ? st.next.title : "Rien d’urgent à l’horizon";
  $("#nextTitle").onclick = () => st.next && openTask(st.next.id);
  tickNext();
  // Tuiles
  $("#wReviewN").textContent = pad(c.revue);
  $("#wReviewTxt").textContent = c.probables ? `dont ${c.probables} probablement déjà traitées` : "demandes reçues avant Vigie Tour";
  $("#wReviewBtn").disabled = !c.revue;
  const lot = (st.lots || [])[0];
  $("#wLotN").textContent = pad(lot ? lot.n : 0);
  $("#wLotTxt").textContent = lot ? `tâches « ${lot.lot} » à traiter en série` : "aucun lot pour l’instant";
  $("#wLotBtn").disabled = !lot;
  $("#wLotBtn").onclick = () => lot && setView("tout", { lot: lot.lot });
  $("#wWaitN").textContent = pad(c.en_attente);
  const max = Math.max(1, ...st.flux.map((f) => f.n));
  $("#fluxTotal").textContent = st.flux.reduce((a, f) => a + f.n, 0);
  $("#fluxBars").innerHTML = st.flux.map((f) => {
    const title = `title="${f.day} : ${f.n} mail${f.n > 1 ? "s" : ""}"`;
    if (!bento) return `<span ${title} style="height:${Math.max(3, (f.n / max) * 100)}%"></span>`;
    const k = Math.max(f.n ? 1 : 0, Math.round((f.n / max) * 9));
    return `<span ${title}>${Array.from({ length: 9 }, (_, i) => `<i class="${i < k ? "on" : ""}"></i>`).join("")}</span>`;
  }).join("");
}
function tickNext() {
  const n = S.next;
  if (!n) { $("#nextCd").textContent = "—"; $("#nextDay").textContent = ""; $("#ringFg").style.strokeDasharray = "0 276.5"; return; }
  const ms = dueDate(n) - Date.now();
  if (ms <= 0) { $("#nextCd").textContent = "Échue"; $("#ringFg").style.strokeDasharray = "0 276.5"; }
  else {
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400);
    $("#nextCd").textContent = d >= 1 ? `${d} j ${pad(Math.floor(s % 86400 / 3600))} h` : `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}`;
    $("#ringFg").style.strokeDasharray = `${(Math.min(1, ms / 864e5) * 276.5).toFixed(1)} 276.5`;
  }
  $("#nextDay").textContent = longDate(n.deadline);
}

/* ===================== Liste ===================== */
async function loadTasks(keepSel) {
  const v = VIEWS.find((x) => x.id === S.view) || VIEWS[1];
  const params = new URLSearchParams({ view: S.view });
  if (S.q) params.set("q", S.q);
  if (S.lot) params.set("lot", S.lot);
  S.tasks = await api("/api/tasks?" + params);
  if (S.only) S.tasks = S.tasks.filter((t) => S.only.ids.includes(t.id));
  $("#viewTitle").textContent = S.only ? `Sélection · ${S.only.label}` : S.lot ? `Lot · ${S.lot}` : v.label;
  $("#viewSub").textContent = `${S.tasks.length} tâche${S.tasks.length > 1 ? "s" : ""}` + (S.q ? ` · recherche « ${S.q} »` : "") + ` · ${v.sub}`;
  if (!keepSel || !S.tasks.find((t) => t.id === S.sel)) S.sel = S.tasks[0] ? S.tasks[0].id : null;
  renderTools(); renderList(); renderDetail();
}
function renderTools() {
  const tools = [];
  if (S.only) tools.push(`<button class="chip" id="clearOnly">Sélection de l’IA ✕</button>`);
  if (S.lot) tools.push(`<button class="chip" id="clearLot">Lot · ${esc(S.lot)} ✕</button>`);
  if (S.q) tools.push(`<button class="chip" id="clearQ">« ${esc(S.q)} » ✕</button>`);
  if (S.view === "probables" && S.tasks.length) tools.push(`<button class="btn sm acc" id="confirmAll">Tout confirmer comme traité</button>`);
  if (S.view === "revue" && S.tasks.length) tools.push(`<button class="btn sm acc" id="startReview">Lancer la revue rapide</button>`);
  if (S.lot && S.tasks.length) tools.push(`<button class="btn sm" id="lotDone">Tout le lot est fait</button>`);
  tools.push(`<button class="btn sm ghost" id="toggleDash">${S.dashHidden ? "Afficher" : "Masquer"} le briefing</button>`);
  $("#listTools").innerHTML = tools.join("");
  $("#clearOnly")?.addEventListener("click", () => { S.only = null; loadTasks(); });
  $("#clearLot")?.addEventListener("click", () => { S.lot = null; loadTasks(); });
  $("#clearQ")?.addEventListener("click", () => { S.q = ""; $("#cmd").value = ""; loadTasks(); });
  $("#startReview")?.addEventListener("click", startReview);
  $("#toggleDash").onclick = () => toggleDash();
  $("#confirmAll")?.addEventListener("click", async () => {
    if (!confirm(`Marquer ces ${S.tasks.length} anciennes demandes comme déjà traitées ?`)) return;
    await api("/api/bulk", { ids: S.tasks.map((t) => t.id), fields: { status: "fait", reviewed: 1 }, note: "[traité hors mail]" });
    toast(`${S.tasks.length} demandes classées comme traitées`); refreshState(); loadTasks();
  });
  $("#lotDone")?.addEventListener("click", async () => {
    if (!confirm(`Marquer les ${S.tasks.length} tâches du lot « ${S.lot} » comme faites ?`)) return;
    await api("/api/bulk", { ids: S.tasks.map((t) => t.id), fields: { status: "fait" } });
    toast("Lot terminé ✓"); refreshState(); loadTasks();
  });
}
function renderList(scroll) {
  const list = $("#list");
  if (!S.tasks.length) { list.innerHTML = `<div class="empty"><b>✓</b>Rien ici pour l’instant.</div>`; return; }
  const byGroup = S.view === "fait" ? [["all", "Récemment terminées", S.tasks]]
    : GROUPS.map(([k, label]) => [k, label, S.tasks.filter((t) => group(t) === k)]).filter((g) => g[2].length);
  list.innerHTML = byGroup.map(([k, label, items]) =>
    `<div class="ghead ${k === "late" ? "hot" : ""}"><span>${label}</span><span class="num">${items.length}</span></div>` +
    items.map((t) => {
      const g = group(t), sel = t.id === S.sel;
      return `<div class="row ${sel ? "sel" : ""}" data-id="${t.id}">
        <button class="chk" data-act="done" aria-label="Marquer comme fait">${svg("check")}</button>
        <button class="rowbtn" data-act="pick"><span class="ttl">${esc(t.title)}</span>
          <span class="meta"><span class="tid">#${t.id}</span><span>${esc(t.last_from || "")}</span><span class="tag">${KIND[t.kind] || t.kind}</span>${t.priority === "haute" ? `<span class="tag prio-haute">Haute</span>` : ""}${t.lot ? `<span class="tag lot">${esc(t.lot)}</span>` : ""}${folderTag(t.folder)}${t.status !== "a_faire" && STATUS[t.status] ? `<span>· ${STATUS[t.status]}</span>` : ""}</span>
        </button>
        <span class="when ${g === "late" ? "late" : g === "today" ? "soon" : ""}">${whenLabel(t)}</span>
        ${sel ? `<div class="quick">
          <button class="btn sm pri" data-act="done">Fait</button>
          <button class="btn sm" data-act="snooze">Reporter</button>
          <button class="btn sm" data-act="reply" ${t.draft_reply ? "" : "disabled"}>Copier la réponse</button>
          ${t.delegate_to || t.kind === "a_transferer" ? `<button class="btn sm" data-act="delegate">Transférer</button>` : ""}
          <button class="btn sm ghost" data-act="ignore">Ignorer</button></div>` : ""}
      </div>`;
    }).join("")).join("");
  list.querySelectorAll(".row").forEach((row) => {
    const id = +row.dataset.id;
    row.querySelectorAll("[data-act]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); act(b.dataset.act, id, b); });
  });
  if (scroll) list.querySelector(".row.sel")?.scrollIntoView({ block: "nearest" });
}
function pick(id, scroll) { S.sel = id; renderList(scroll); renderDetail(); }
async function openTask(id) {
  if (!S.tasks.find((t) => t.id === id)) { S.view = "tout"; S.lot = null; S.q = ""; renderNav(); await loadTasks(); }
  pick(id);
}

/* ===================== Actions ===================== */
async function update(id, fields, msg) { await api("/api/task", { id, ...fields }); if (msg) toast(msg); }
async function setStatus(id, status, msg, extra = {}) {
  const row = document.querySelector(`.row[data-id="${id}"]`);
  const idx = S.tasks.findIndex((t) => t.id === id);
  if (row && status !== "en_cours" && S.view !== "fait") { row.classList.add("leaving"); await new Promise((r) => setTimeout(r, 200)); }
  await update(id, { status, ...extra }, msg);
  await loadTasks(true);
  if (S.tasks.length && !S.tasks.find((t) => t.id === S.sel)) { S.sel = S.tasks[Math.min(Math.max(idx, 0), S.tasks.length - 1)].id; renderList(); renderDetail(); }
  refreshState();
}
function act(action, id, anchor) {
  const t = S.tasks.find((x) => x.id === id);
  if (action === "pick") return pick(id);
  if (action === "done") return setStatus(id, "fait", "Tâche terminée ✓");
  if (action === "ignore") return setStatus(id, "ignore", "Tâche ignorée");
  if (action === "snooze") return snoozeMenu(id, anchor);
  if (action === "reply") return t && t.draft_reply && copy(t.draft_reply, "Réponse copiée — colle-la dans Outlook");
  if (action === "delegate") {
    const who = (t && t.delegate_to) || prompt("Transférer à qui ?");
    if (!who) return;
    copy(`Bonjour,\n\nJe te transfère cette demande qui relève de ton périmètre : ${t ? t.title : ""}.\n\nMerci !\n${(S.st && S.st.me) || ""}`, `Message de transfert copié · tâche confiée à ${who}`);
    return setStatus(id, "delegue", null, { delegate_to: who });
  }
}
function snoozeMenu(id, anchor) {
  const m = $("#menu"), r = (anchor || $("#detail")).getBoundingClientRect();
  const tonight = new Date(); tonight.setHours(18, 0, 0, 0);
  const monday = addDays(((8 - new Date().getDay()) % 7) || 7);
  const opts = [];
  if (tonight > new Date()) opts.push(["Ce soir", "18:00", tonight]);
  opts.push(["Demain matin", "9:00", addDays(1)], ["Lundi prochain", monday.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }), monday], ["Dans une semaine", "", addDays(7)]);
  m.innerHTML = opts.map((o, i) => `<button data-i="${i}"><span>${o[0]}</span><small>${o[1]}</small></button>`).join("") +
    `<label class="small muted" style="display:block;padding:8px 12px 4px">Autre date<input type="date" id="snoozeDate" min="${todayIso()}"></label>`;
  m.style.left = Math.min(r.left, innerWidth - 250) + "px"; m.style.top = Math.min(r.bottom + 6, innerHeight - 280) + "px";
  m.classList.remove("hidden");
  const done = async (d) => { m.classList.add("hidden"); await update(id, { snooze_until: localIso(d) }, `Reportée au ${d.toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`); loadTasks(true); refreshState(); };
  m.querySelectorAll("[data-i]").forEach((b) => b.onclick = () => done(opts[+b.dataset.i][2]));
  $("#snoozeDate").onchange = (e) => e.target.value && done(new Date(e.target.value + "T09:00"));
  setTimeout(() => document.addEventListener("click", function off(e) { if (!m.contains(e.target)) { m.classList.add("hidden"); document.removeEventListener("click", off); } }), 0);
}

/* ===================== Détail ===================== */
async function renderDetail() {
  const d = $("#detail"), t = S.tasks.find((x) => x.id === S.sel);
  if (!t) { d.innerHTML = `<div class="placeholder">Sélectionne une tâche pour voir le plan d’action, la réponse prête et le fil de mails.</div>`; return; }
  const checked = JSON.parse(store("mp.steps." + t.id) || "[]");
  d.innerHTML = `
    <div class="tags"><span class="tag">${KIND[t.kind] || t.kind}</span>
      <span class="tag ${t.priority === "haute" ? "prio-haute" : ""}">Priorité ${esc(t.priority || "")}</span>
      ${t.lot ? `<span class="tag lot">${esc(t.lot)}</span>` : ""}${folderTag(t.folder)}<span class="tag" title="${(SOURCE[t.source] || SOURCE.claude)[1]}">${(SOURCE[t.source] || SOURCE.claude)[0]} · ${Math.round((t.confidence || 0) * 100)} %</span></div>
    <h3>${esc(t.title)}</h3>
    <p class="sum">${esc(t.summary || "")}</p>
    <div class="props">
      <div class="field"><label for="fDeadline">Échéance${t.deadline_type === "estimee" ? " (estimée)" : ""}</label><input type="date" id="fDeadline" value="${esc(t.deadline || "")}"></div>
      <div class="field"><label for="fPrio">Priorité</label><select id="fPrio">${["haute", "moyenne", "basse"].map((p) => `<option ${p === t.priority ? "selected" : ""}>${p}</option>`).join("")}</select></div>
      <div class="field"><label for="fKind">Type</label><select id="fKind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${k === t.kind ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="field"><label for="fStatus">Statut</label><select id="fStatus">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${k === t.status ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    </div>
    ${t.evidence ? `<div class="sec">Pourquoi</div><div class="why"><span class="why-src">› source #${t.id} · ${esc(t.last_from || "")}</span>« ${esc(t.evidence)} » <span class="muted">· ${esc(t.last_from || "")}</span></div>` : ""}
    ${t.steps && t.steps.length ? `<div class="sec">Plan d’action <span class="num">${checked.length}/${t.steps.length}</span></div>` +
      t.steps.map((s, i) => `<label class="step ${checked.includes(i) ? "ok" : ""}"><input type="checkbox" data-step="${i}" ${checked.includes(i) ? "checked" : ""}><span>${esc(s)}</span></label>`).join("") : ""}
    ${t.delegate_to ? `<div class="sec">Suggestion</div><div class="deleg"><span class="avatar">${initials(t.delegate_to)}</span>
      <div style="flex:1;min-width:0"><div>Transférer à <b style="font-weight:600">${esc(t.delegate_to)}</b></div><div class="muted small">${esc(t.delegate_reason || "")}</div></div>
      <button class="btn sm" data-act="delegate">Transférer</button></div>` : ""}
    ${t.draft_reply ? `<div class="sec">${t.source === "local" ? "Réponse type" : "Réponse prête"}</div><div class="draft">${esc(t.draft_reply)}</div>` : `<div class="sec">Réponse</div>`}
      <div class="acts">${t.draft_reply ? `<button class="btn pri" data-act="reply">Copier la réponse</button>` : ""}<button class="btn" id="openOutlook">Ouvrir dans Outlook</button>
        <button class="btn acc" id="askDraft" title="Un appel à Claude (Haiku), environ 3 000 jetons">✦ Rédiger avec Claude</button></div>
    <div class="sec">Notes</div><textarea id="fNotes" placeholder="Tes notes…">${esc(t.notes || "")}</textarea>
    <div class="acts"><button class="btn pri" data-act="done">Marquer comme fait</button><button class="btn" data-act="snooze">Reporter</button><button class="btn ghost" data-act="ignore">Ignorer</button></div>
    <div class="sec">Conversation · ${t.msg_count || 1} message${(t.msg_count || 1) > 1 ? "s" : ""} <button class="btn sm ghost" id="reanalyze" title="Un appel à Claude (Haiku), environ 4 000 jetons">✦ Analyser avec Claude</button></div>
    <div id="thread" class="muted small">Chargement…</div>`;
  d.querySelectorAll("[data-act]").forEach((b) => b.onclick = () => act(b.dataset.act, t.id, b));
  d.querySelectorAll("[data-step]").forEach((c) => c.onchange = () => {
    const set = new Set(JSON.parse(store("mp.steps." + t.id) || "[]"));
    c.checked ? set.add(+c.dataset.step) : set.delete(+c.dataset.step);
    store("mp.steps." + t.id, JSON.stringify([...set])); renderDetail();
  });
  $("#fDeadline").onchange = (e) => update(t.id, { deadline: e.target.value || null }, "Échéance modifiée").then(() => loadTasks(true));
  $("#fPrio").onchange = (e) => update(t.id, { priority: e.target.value }, "Priorité modifiée").then(() => loadTasks(true));
  $("#fKind").onchange = (e) => update(t.id, { kind: e.target.value }, "Type modifié").then(() => { loadTasks(true); refreshState(); });
  $("#fStatus").onchange = (e) => setStatus(t.id, e.target.value, "Statut modifié");
  $("#fNotes").onchange = (e) => update(t.id, { notes: e.target.value }, "Note enregistrée");
  $("#reanalyze").onclick = (e) => askClaude(e.currentTarget, "/api/reanalyze", { thread_key: t.thread_key });
  $("#askDraft").onclick = (e) => askClaude(e.currentTarget, "/api/draft", { id: t.id });
  const msgs = await api("/api/thread?key=" + encodeURIComponent(t.thread_key));
  if (S.sel !== t.id) return;
  const outlook = $("#openOutlook");
  if (outlook) outlook.onclick = () => openMessage(msgs.filter((m) => m.direction === "in").pop() || msgs[msgs.length - 1], t);
  $("#thread").className = "";
  $("#thread").innerHTML = msgs.map((m, i) => `<div class="msg ${m.direction === "out" ? "out" : ""} ${i < msgs.length - 1 ? "collapsed" : ""}">
    <div class="msg-head"><span><b style="font-weight:600">${esc(m.direction === "out" ? "Moi" : m.from_name)}</b> · ${fmtDT(m.date_utc)}${m.has_attachments ? " · pièce jointe" : ""}</span>
    ${m.web_link || m.can_open ? `<button class="btn sm ghost" data-open="${i}">Ouvrir</button>` : ""}</div>
    <div class="msg-body">${esc(m.body || "")}</div></div>`).join("");
  $("#thread").querySelectorAll(".msg-head").forEach((h) => h.onclick = (e) => { if (!e.target.closest("[data-open]")) h.parentElement.classList.toggle("collapsed"); });
  $("#thread").querySelectorAll("[data-open]").forEach((b) => b.onclick = () => openMessage(msgs[+b.dataset.open], t));
}
async function openMessage(m, t) {
  if (m && m.web_link) { window.open(m.web_link, "_blank"); return toast("Mail ouvert dans Outlook"); }
  if (m && m.can_open && (await api("/api/open", { msg_id: m.msg_id })).ok) return toast("Mail ouvert dans Outlook");
  copy((m && m.subject) || t.thread_subject || t.title, "Objet copié — recherche-le dans Outlook");
  window.open("https://outlook.office.com/mail/", "_blank");
}

/* ===================== Revue de l’historique ===================== */
async function startReview() {
  const items = await api("/api/tasks?view=revue");
  if (!items.length) return toast("Aucune ancienne demande à revoir 🎉".replace(" 🎉", ""));
  S.review = { items, i: 0, stats: { fait: 0, garde: 0, deleg: 0, ignore: 0 } };
  $("#review").classList.remove("hidden");
  renderReview();
}
function renderReview() {
  const R = S.review, el = $("#review");
  if (R.i >= R.items.length) {
    el.innerHTML = `<div class="sheet"><h2>Revue terminée</h2><p class="muted">${R.stats.fait} déjà traitées · ${R.stats.garde} gardées · ${R.stats.deleg} transférées · ${R.stats.ignore} ignorées.</p>
      <div class="acts"><button class="btn pri" id="rvClose">Fermer</button></div></div>`;
    $("#rvClose").onclick = closeReview; return;
  }
  const t = R.items[R.i];
  el.innerHTML = `<div class="sheet">
    <div class="eyebrow"><span>Revue de l’historique</span><span class="num">${R.i + 1} / ${R.items.length}</span></div>
    <div class="progress"><i style="width:${(R.i / R.items.length) * 100}%"></i></div>
    <div class="rv-card">
      <div class="tags"><span class="tag">${KIND[t.kind] || t.kind}</span>${t.lot ? `<span class="tag lot">${esc(t.lot)}</span>` : ""}<span class="tag">Dernier message : ${fmtDT(t.last_date)}</span></div>
      <h3>${esc(t.title)}</h3>
      <p class="muted" style="margin:0">${esc(t.summary || "")}</p>
      <p class="small muted" style="margin:10px 0 0">De ${esc(t.last_from || "")}${t.deadline ? ` · échéance ${longDate(t.deadline)}` : ""}</p>
    </div>
    <div class="rv-actions">
      <button class="btn acc" data-rv="fait">Déjà traité<kbd>X</kbd></button>
      <button class="btn" data-rv="garde">Garder<kbd>Entrée</kbd></button>
      <button class="btn" data-rv="deleg">Transférer<kbd>T</kbd></button>
      <button class="btn" data-rv="ignore">Ignorer<kbd>I</kbd></button>
      <button class="btn ghost" data-rv="skip">Plus tard<kbd>→</kbd></button>
    </div>
    <div class="acts" style="justify-content:space-between"><span class="small muted">Chaque choix est enregistré tout de suite.</span><button class="btn sm ghost" id="rvClose">Fermer (Échap)</button></div>
  </div>`;
  el.querySelectorAll("[data-rv]").forEach((b) => b.onclick = () => reviewChoice(b.dataset.rv));
  $("#rvClose").onclick = closeReview;
}
async function reviewChoice(choice) {
  const R = S.review, t = R.items[R.i];
  if (!t) return;
  const map = { fait: { status: "fait", reviewed: 1 }, garde: { reviewed: 1 }, deleg: { status: "delegue", reviewed: 1 }, ignore: { status: "ignore", reviewed: 1 } };
  if (map[choice]) {
    await api("/api/bulk", { ids: [t.id], fields: map[choice], note: choice === "fait" ? "[traité hors mail]" : null });
    R.stats[choice]++;
  }
  R.i++; renderReview();
}
function closeReview() { $("#review").classList.add("hidden"); S.review = null; refreshState(); loadTasks(true); }

/* ===================== Disposition : blocs déplaçables et redimensionnables ===================== */
const BLOCKS = { brief: "Bonjour / résumé", next: "Prochaine échéance", globe: "Globe réseau", console: "Console du moteur", review: "Revue de l’historique", lot: "Lot détecté", wait: "Attentes", flux: "Mails reçus" };
const LAYOUT0 = () => ({ order: Object.keys(BLOCKS), size: { brief: { c: 2 }, console: { c: 4 } }, hidden: ["flux"], detailW: 420, swap: false });
let L = (() => { try { return { ...LAYOUT0(), ...JSON.parse(store("mp.layout") || "{}") }; } catch (e) { return LAYOUT0(); } })();
const saveLayout = () => store("mp.layout", JSON.stringify(L));
if (!L.order.includes("console")) {  // disposition enregistrée avant la console : on l'insère après le globe, elle remplace « Mails reçus »
  const i = L.order.indexOf("globe");
  L.order.splice(i < 0 ? L.order.length : i + 1, 0, "console");
  L.size = { ...L.size, console: { c: 4 } };
  if (!L.hidden.includes("flux")) L.hidden.push("flux");
  saveLayout();
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dashCols = () => getComputedStyle($("#dash")).gridTemplateColumns.split(" ").filter(Boolean).length || 4;
const blockEls = () => [...$("#dash").querySelectorAll("[data-block]")];

function applyLayout() {
  const dash = $("#dash"), cols = dashCols();
  const order = [...L.order.filter((k) => BLOCKS[k]), ...Object.keys(BLOCKS).filter((k) => !L.order.includes(k))];
  for (const id of order) {
    const el = dash.querySelector(`[data-block="${id}"]`);
    if (!el) continue;
    dash.appendChild(el);
    const sz = L.size[id] || {};
    el.style.gridColumn = `span ${clamp(sz.c || 1, 1, cols)}`;
    el.style.minHeight = sz.h ? sz.h + "px" : "";
    el.classList.toggle("hidden", L.hidden.includes(id));
  }
  L.detailW = clamp(L.detailW, 320, Math.max(320, $(".content").clientWidth - 420));
  document.documentElement.style.setProperty("--detail-w", L.detailW + "px");
  $(".content").classList.toggle("swap", !!L.swap);
  sizeGlobe();
}
function sizeGlobe() {
  const card = $('[data-block="globe"]'), cv = $("#globe");
  if (!card || !cv) return;
  const cs = getComputedStyle(card), inner = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const wanted = Math.max(230, ((L.size.globe || {}).h || 0) - 90);
  cv.style.width = cv.style.maxWidth = Math.round(clamp(Math.min(inner, wanted), 140, 560)) + "px";
}
// Animation douce des autres blocs quand l'un change de place (technique FLIP)
function flip(mutate, skip) {
  const els = blockEls().filter((c) => c !== skip && !c.classList.contains("hidden"));
  const first = new Map(els.map((c) => [c, c.getBoundingClientRect()]));
  mutate();
  for (const c of els) {
    const a = first.get(c), b = c.getBoundingClientRect();
    if (Math.abs(a.left - b.left) + Math.abs(a.top - b.top) > 1)
      c.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: "none" }], { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
}
function drag(handle, e, onMove, onEnd, mode) {
  e.preventDefault(); e.stopPropagation();
  handle.setPointerCapture(e.pointerId);
  document.body.classList.add("layout-busy", mode);
  const move = (ev) => onMove(ev);
  const end = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    document.body.classList.remove("layout-busy", mode);
    onEnd(); saveLayout();
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}
function startMove(card, handle, e) {
  const dash = $("#dash"), r0 = card.getBoundingClientRect(), off = { x: e.clientX - r0.left, y: e.clientY - r0.top };
  let lock = 0;
  card.classList.add("dragging");
  drag(handle, e, (ev) => {
    const others = blockEls().filter((c) => c !== card && !c.classList.contains("hidden"));
    const target = Date.now() > lock && others.find((c) => {
      const r = c.getBoundingClientRect();
      return ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom;
    });
    if (target) {
      const all = blockEls(), before = all.indexOf(card) > all.indexOf(target);
      flip(() => dash.insertBefore(card, before ? target : target.nextSibling), card);
      lock = Date.now() + 260;
    }
    card.style.transform = "none";
    const r = card.getBoundingClientRect();
    card.style.transform = `translate(${ev.clientX - off.x - r.left}px, ${ev.clientY - off.y - r.top}px)`;
  }, () => {
    const r = card.getBoundingClientRect();
    card.style.transform = "";
    const b = card.getBoundingClientRect();
    card.animate([{ transform: `translate(${r.left - b.left}px, ${r.top - b.top}px)` }, { transform: "none" }], { duration: 200, easing: "ease-out" });
    card.classList.remove("dragging");
    L.order = blockEls().map((c) => c.dataset.block);
  }, "mv");
}
function startResize(card, handle, e) {
  const dash = $("#dash"), cols = dashCols(), gap = parseFloat(getComputedStyle(dash).columnGap) || 16;
  const colW = (dash.clientWidth - gap * (cols - 1)) / cols, r0 = card.getBoundingClientRect(), id = card.dataset.block;
  const sz = { ...(L.size[id] || {}) };
  card.classList.add("resizing");
  drag(handle, e, (ev) => {
    const c = clamp(Math.round((r0.width + ev.clientX - e.clientX + gap) / (colW + gap)), 1, cols);
    const dy = ev.clientY - e.clientY;
    if (c !== (sz.c || 1)) { sz.c = c; flip(() => { card.style.gridColumn = `span ${c}`; }, card); }
    if (Math.abs(dy) > 6 || sz.h) { sz.h = Math.max(140, Math.round((r0.height + dy) / 10) * 10); card.style.minHeight = sz.h + "px"; }
    L.size[id] = sz; sizeGlobe();
  }, () => { card.classList.remove("resizing"); }, "rs");
}
function setupLayout() {
  for (const card of blockEls()) {
    card.insertAdjacentHTML("beforeend",
      `<div class="blk-tools"><button class="blk-grip" title="Déplacer le bloc" aria-label="Déplacer le bloc">${svg("grip")}</button>` +
      `<button class="blk-hide" title="Masquer ce bloc (Réglages pour le réafficher)" aria-label="Masquer ce bloc">${svg("hide")}</button></div>` +
      `<span class="blk-rs" title="Glisser pour redimensionner · double-clic : taille d’origine"></span>`);
    const grip = card.querySelector(".blk-grip"), rs = card.querySelector(".blk-rs");
    grip.addEventListener("pointerdown", (e) => startMove(card, grip, e));
    rs.addEventListener("pointerdown", (e) => startResize(card, rs, e));
    rs.addEventListener("dblclick", () => {
      const id = card.dataset.block;
      delete L.size[id];
      if (id === "brief") L.size.brief = { c: 2 };
      flip(applyLayout); saveLayout();
    });
    card.querySelector(".blk-hide").onclick = () => {
      L.hidden.push(card.dataset.block); flip(applyLayout); saveLayout();
      toast(`Bloc « ${BLOCKS[card.dataset.block]} » masqué · Réglages › Disposition pour le réafficher`);
    };
  }
  const sp = $("#splitter");
  sp.addEventListener("pointerdown", (e) => {
    const x0 = e.clientX, w0 = $("#detail").getBoundingClientRect().width, max = $(".content").clientWidth - 420;
    sp.classList.add("on");
    drag(sp, e, (ev) => {
      L.detailW = Math.round(clamp(w0 + (L.swap ? 1 : -1) * (ev.clientX - x0), 320, max));
      document.documentElement.style.setProperty("--detail-w", L.detailW + "px");
    }, () => sp.classList.remove("on"), "split");
  });
  sp.addEventListener("dblclick", () => { L.detailW = 420; applyLayout(); saveLayout(); });
  let t;
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(applyLayout, 150); });
  applyLayout();
}

/* ===================== Réglages ===================== */
async function openSettings() {
  const el = $("#settings"), th = document.documentElement.dataset.theme, mo = document.documentElement.dataset.mode, st = S.st || {};
  const [folders, usage] = await Promise.all([api("/api/folders").catch(() => []), api("/api/usage").catch(() => [])]);
  const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");
  const week = usage.reduce((a, d) => ({ calls: a.calls + d.calls, tin: a.tin + d.tokens_in, tout: a.tout + d.tokens_out }), { calls: 0, tin: 0, tout: 0 });
  el.innerHTML = `<div class="sheet">
    <h2>Réglages</h2>
    <div class="sec">Thème</div>
    <div class="themes">
      <button class="theme-card ${th === "spatial" ? "on" : ""}" data-t="spatial"><div class="pv pv-spatial"></div><b>Spatial</b><div class="small muted">Verre, profondeur, halos lumineux</div></button>
      <button class="theme-card ${th === "bento" ? "on" : ""}" data-t="bento"><div class="pv pv-bento"></div><b>Bento</b><div class="small muted">Tuiles, matrice de points, accent rouge</div></button>
    </div>
    <div class="seg"><button class="${mo === "dark" ? "on" : ""}" data-m="dark">Sombre</button><button class="${mo === "light" ? "on" : ""}" data-m="light">Clair</button></div>
    <div class="seg" title="Pluie Matrix, terminaux et console du moteur (thème Spatial)"><button class="${document.documentElement.dataset.lab === "on" ? "on" : ""}" data-labset="on">Décor labo</button><button class="${document.documentElement.dataset.lab === "on" ? "" : "on"}" data-labset="off">Sans décor</button></div>

    <div class="sec">Disposition</div>
    <p class="small muted" style="margin:0">Survole un bloc : la poignée <b>⠿</b> le déplace, le coin en bas à droite l’agrandit. Le trait entre la liste et le détail règle leur largeur.</p>
    <div class="blocks">${Object.entries(BLOCKS).map(([k, l]) => `<label><input type="checkbox" data-blk="${k}" ${L.hidden.includes(k) ? "" : "checked"}>${l}</label>`).join("")}</div>
    <div class="acts" style="margin-top:4px">
      <div class="seg"><button class="${L.swap ? "" : "on"}" data-swap="0">Détail à droite</button><button class="${L.swap ? "on" : ""}" data-swap="1">Détail à gauche</button></div>
      <button class="btn" id="setDash">${S.dashHidden ? "Afficher" : "Masquer"} tout le briefing</button>
      <button class="btn ghost" id="setReset">Réinitialiser la disposition</button>
    </div>

    <div class="sec">Dossiers Outlook surveillés</div>
    <p class="small muted" style="margin:0">Les mails des dossiers cochés sont analysés comme ceux de la boîte de réception. Les formulaires web qui ne te concernent pas sont écartés partout.</p>
    <div class="folders">${folders.length ? folders.map((f) => `<label><input type="checkbox" data-folder="${esc(f.name)}" ${f.excluded ? "" : "checked"} ${/^(courrier ind|junk)/i.test(f.name) ? "disabled" : ""}><span>${esc(f.name)}</span><small>${f.count} mail${f.count > 1 ? "s" : ""}</small></label>`).join("")
      : `<p class="small muted">La liste des dossiers arrive avec le flux Power Automate.</p>`}</div>
    <div class="acts" style="margin-top:4px"><button class="btn sm acc" id="setFolders">Enregistrer les dossiers</button></div>

    <div class="sec">Consommation Claude · 7 jours</div>
    <table class="usage"><thead><tr><th>Jour</th><th>Appels</th><th>Jetons lus</th><th>Jetons écrits</th></tr></thead><tbody>
      ${usage.slice().reverse().map((d) => `<tr><td>${new Date(d.day + "T12:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}</td><td>${d.calls}</td><td>${fmt(d.tokens_in)}</td><td>${fmt(d.tokens_out)}</td></tr>`).join("")}
      <tr><td><b>Total</b></td><td><b>${week.calls}</b></td><td><b>${fmt(week.tin)}</b></td><td><b>${fmt(week.tout)}</b></td></tr></tbody></table>
    <p class="small muted" style="margin:0">Claude n’est appelé que quand tu cliques sur ✦ (analyser un fil, rédiger une réponse, barre de commande), avec le modèle Haiku.</p>

    <div class="sec">Moteur</div>
    <p class="small" style="margin:0"><b>${esc((st.llm || {}).message || "")}</b> : chaque mail récent qui t’est adressé est relu sur ce PC, sans jeton. Premier tri instantané par règles (demandes, échéances, engagements, attentes) + apprentissage
      de ${(st.learning || {}).examples || 0} conversations analysées et de ${(st.learning || {}).decisions || 0} de tes décisions. Chaque « Fait », « Ignorer » ou changement de type/priorité l’affine.</p>
    <p class="small muted" style="margin:0">${st.messages || 0} mails · ${st.threads || 0} conversations · mise en service le ${longDate(st.installed_at)}</p>
    <div class="acts"><button class="btn" id="setSync">Synchroniser maintenant</button><button class="btn" id="setEngine">Vérifier la connexion Claude</button></div>

    <div class="sec">À propos</div>
    <div style="display:flex;align-items:center;gap:14px">
      <img src="vigie.png" alt="" width="48" height="48" style="border-radius:12px">
      <p class="small" style="margin:0"><b>Vigie Tour</b> — la tour de guet de tes mails : rien ne passe sans être vu.<br>
      <span class="muted">Conçu et développé par <b>Charles Atangui</b> · 2026</span></p>
    </div>
    <div class="acts" style="justify-content:flex-end"><button class="btn pri" id="setClose">Fermer</button></div>
  </div>`;
  el.classList.remove("hidden");
  el.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => { applyTheme(b.dataset.t); openSettings(); });
  el.querySelectorAll("[data-m]").forEach((b) => b.onclick = () => { applyTheme(null, b.dataset.m); openSettings(); });
  el.querySelectorAll("[data-labset]").forEach((b) => b.onclick = () => {
    document.documentElement.dataset.lab = b.dataset.labset; store("mp.lab", b.dataset.labset === "on" ? "1" : "0");
    applyTheme(); openSettings();
  });
  el.querySelectorAll("[data-blk]").forEach((c) => c.onchange = () => {
    L.hidden = L.hidden.filter((k) => k !== c.dataset.blk).concat(c.checked ? [] : [c.dataset.blk]);
    applyLayout(); saveLayout();
  });
  el.querySelectorAll("[data-swap]").forEach((b) => b.onclick = () => { L.swap = b.dataset.swap === "1"; applyLayout(); saveLayout(); openSettings(); });
  $("#setReset").onclick = () => { L = LAYOUT0(); flip(applyLayout); saveLayout(); openSettings(); toast("Disposition d’origine rétablie"); };
  $("#setFolders").onclick = async () => {
    const excluded = [...el.querySelectorAll("[data-folder]")].filter((c) => !c.checked).map((c) => c.dataset.folder);
    const r = await api("/api/folders", { excluded });
    toast(r.threads ? `Dossiers enregistrés · ${r.threads} conversation${r.threads > 1 ? "s" : ""} à (ré)analyser` : "Dossiers enregistrés");
    refreshState();
  };
  $("#setSync").onclick = syncNow;
  $("#setEngine").onclick = async () => { toast("Vérification…"); toast((await api("/api/engine", {})).message); };
  $("#setDash").onclick = () => { toggleDash(); openSettings(); };
  $("#setClose").onclick = () => el.classList.add("hidden");
  el.onclick = (e) => { if (e.target === el) el.classList.add("hidden"); };
}

/* ===================== Barre de commande ===================== */
const ACT_LABEL = {
  done: (a) => `Marquer comme fait · ${a.ids.length} tâche${a.ids.length > 1 ? "s" : ""}`,
  snooze: (a) => `Reporter ${a.ids.length} tâche${a.ids.length > 1 ? "s" : ""} au ${a.until ? new Date(a.until).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "?"}`,
  delegate: (a) => `Confier ${a.ids.length} tâche${a.ids.length > 1 ? "s" : ""} à ${a.to || "?"}`,
  priority: (a) => `Passer ${a.ids.length} tâche${a.ids.length > 1 ? "s" : ""} en priorité ${a.priority}`,
  deadline: (a) => `Échéance de ${a.ids.length} tâche${a.ids.length > 1 ? "s" : ""} au ${longDate(a.deadline)}`,
  filter: (a) => `Affichées dans la liste · ${a.ids.length} tâche${a.ids.length > 1 ? "s" : ""}`,
};
async function applyAction(a) {
  const f = { done: { status: "fait" }, snooze: { snooze_until: a.until }, delegate: { status: "delegue", delegate_to: a.to }, priority: { priority: a.priority }, deadline: { deadline: a.deadline } }[a.type];
  if (a.type === "filter") {
    S.view = "tout"; S.lot = null; S.q = ""; S.sel = null;
    S.only = a.ids.length ? { ids: a.ids, label: a.query || "réponse de l’IA" } : null;
    if (!S.only) { S.q = a.query || ""; $("#cmd").value = S.q; }
    renderNav(); return loadTasks();
  }
  if (f && a.ids.length) { await api("/api/bulk", { ids: a.ids, fields: f }); }
}
async function askAssistant(text) {
  const p = $("#cmdPanel");
  p.classList.remove("hidden");
  p.innerHTML = `<div class="cp-hint"><span class="spinner"></span>Vigie Tour réfléchit à « ${esc(text)} »…</div>`;
  let r;
  try { r = await api("/api/command", { text }); } catch (e) { r = { reply: "Le serveur n’a pas répondu.", actions: [] }; }
  // Afficher une sélection ne modifie rien : appliqué tout de suite. Le reste attend ta confirmation.
  const shown = (r.actions || []).filter((a) => a.type === "filter");
  const acts = (r.actions || []).filter((a) => a.type !== "filter");
  for (const a of shown) await applyAction(a);
  p.innerHTML = `<div class="cp-head">Vigie Tour</div><div class="cp-reply">${esc(r.reply || "")}</div>` +
    shown.map((a) => `<div class="cp-act"><div class="t">${esc(ACT_LABEL.filter(a))}<small>${esc((a.titles || []).join(" · "))}</small></div></div>`).join("") +
    (acts.length ? `<div class="cp-head">Actions proposées</div>` + acts.map((a, i) => `<div class="cp-act"><div class="t">${esc((ACT_LABEL[a.type] || (() => a.type))(a))}<small>${esc((a.titles || []).join(" · "))}</small></div><button class="btn sm acc" data-ap="${i}">Appliquer</button></div>`).join("") +
      (acts.length > 1 ? `<div class="cp-hint" style="justify-content:flex-end"><button class="btn sm pri" id="apAll">Tout appliquer</button></div>` : "") : "") +
    `<div class="cp-hint"><kbd>Échap</kbd> fermer · rien n’est modifié sans ta confirmation</div>`;
  p.querySelectorAll("[data-ap]").forEach((b) => b.onclick = async () => { await applyAction(acts[+b.dataset.ap]); b.textContent = "Appliqué ✓"; b.disabled = true; refreshState(); loadTasks(true); });
  $("#apAll")?.addEventListener("click", async () => { for (const a of acts) await applyAction(a); toast("Actions appliquées ✓"); p.classList.add("hidden"); refreshState(); loadTasks(true); });
}
function setupCommand() {
  const input = $("#cmd"), p = $("#cmdPanel");
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const text = input.value.trim(), question = text.split(/\s+/).length >= 4;   // une phrase = une question pour l'IA
    timer = setTimeout(() => { const q = question ? "" : text; if (q !== S.q) { S.q = q; loadTasks(); } }, 220);
    if (text.length > 2) {
      p.classList.remove("hidden");
      p.innerHTML = question ? `<div class="cp-hint"><kbd>Entrée</kbd> pour demander à Vigie Tour</div>`
        : `<div class="cp-hint">Filtrage en direct sur « ${esc(text)} » · <kbd>Entrée</kbd> pour demander à l’IA</div>`;
    } else p.classList.add("hidden");
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) {
      // Une question n'est pas un mot-clé : on retire le filtrage en direct et on laisse l'IA répondre
      e.preventDefault(); clearTimeout(timer);
      if (S.q) { S.q = ""; loadTasks(); }
      askAssistant(input.value.trim());
    }
    if (e.key === "Escape") { p.classList.add("hidden"); if (!input.value) input.blur(); input.value = ""; S.q = ""; loadTasks(); }
  });
  document.addEventListener("click", (e) => { if (!$("#cmdBox").contains(e.target)) p.classList.add("hidden"); });
}

/* ===================== Clavier ===================== */
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#cmd").focus(); $("#cmd").select(); return; }
  if (S.review) {
    const k = e.key.toLowerCase();
    if (k === "x") reviewChoice("fait"); else if (e.key === "Enter") reviewChoice("garde"); else if (k === "t") reviewChoice("deleg");
    else if (k === "i") reviewChoice("ignore"); else if (e.key === "ArrowRight") reviewChoice("skip"); else if (e.key === "Escape") closeReview();
    return;
  }
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
  if (e.key === "Escape") { $("#menu").classList.add("hidden"); $("#settings").classList.add("hidden"); if (typing) document.activeElement.blur(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  const i = S.tasks.findIndex((t) => t.id === S.sel), t = S.tasks[i], k = e.key.toLowerCase();
  if (k === "j" || e.key === "ArrowDown") { e.preventDefault(); if (i < S.tasks.length - 1) pick(S.tasks[i + 1].id, true); }
  else if (k === "k" || e.key === "ArrowUp") { e.preventDefault(); if (i > 0) pick(S.tasks[i - 1].id, true); }
  else if (e.key === "/") { e.preventDefault(); $("#cmd").focus(); }
  else if (k === "r") syncNow();
  else if (k === "b") toggleDash();
  else if (e.key === "\\") toggleSide();
  else if (!t) return;
  else if (k === "x") act("done", t.id);
  else if (k === "i") act("ignore", t.id);
  else if (k === "e") setStatus(t.id, "en_cours", "En cours");
  else if (k === "s") act("snooze", t.id, document.querySelector(".row.sel [data-act=snooze]"));
  else if (k === "c") act("reply", t.id);
});

/* ===================== Démarrage ===================== */
document.querySelectorAll("[data-theme-btn]").forEach((b) => b.onclick = () => applyTheme(b.dataset.themeBtn));
$("#modeBtn").onclick = () => applyTheme(null, document.documentElement.dataset.mode === "dark" ? "light" : "dark");
$("#syncBtn").onclick = syncNow;
$("#dashBtn").onclick = () => toggleDash();
$("#sideToggle").onclick = toggleSide;
syncShellButtons();
$("#settingsBtn").onclick = openSettings;
$("#wReviewBtn").onclick = startReview;
$("#wWaitBtn").onclick = () => setView("en_attente");
setupCommand();
setupLayout();
applyTheme();
renderNav();
refreshState().then(() => loadTasks());
setInterval(refreshState, 5000);
setInterval(tickNext, 1000);
if (window.MPGlobe) window.MPGlobe($("#globe"));
