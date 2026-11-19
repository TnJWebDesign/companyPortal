/* ==========================================================================
   T&J Company Portal — portal.js
   Everything on the Dashboard tab: app links, weather, task board, uptime
   checks, the stock-alert widget, the clock, theme switch, tab switching,
   and the command console (typed or spoken).

   It talks to app.js only through events:
     "app:unlocked" / "app:locked"   (sent by app.js)
     "inventory:stats"               (sent by app.js whenever stock changes)
   ========================================================================== */


/* ==========================================================================
   1. SETTINGS — edit these lists to change what the dashboard shows
   ========================================================================== */

// App launcher. Each entry: [name, url, optional domain for the icon].
const APPS = [
  { title: "AI Tools", items: [
    ["ChatGPT", "https://chatgpt.com"],
    ["Gemini", "https://gemini.google.com"],
    ["NotebookLM", "https://notebooklm.google.com"],
    ["ElevenLabs", "https://elevenlabs.io"],
    ["Retell AI", "https://retellai.com"],
  ]},
  { title: "Business", items: [
    ["Google Docs", "https://docs.google.com"],
    ["Google Calendar", "https://calendar.google.com"],
    ["GoDaddy", "https://godaddy.com"],
    ["GitHub", "https://github.com"],
    ["n8n", "https://n8n.io"],
    ["Twilio", "https://twilio.com"],
    ["Facebook", "https://facebook.com"],
    ["Instagram", "https://instagram.com"],
    ["YouTube Studio", "https://studio.youtube.com", "youtube.com"],
    ["tnjwebdesign.ca", "https://tnjwebdesign.ca"],
  ]},
  { title: "Advertising", items: [
    ["YouTube Upload", "https://studio.youtube.com/channel/UC6oFrADxWx2n6GGK7u1_FvA/videos/upload?filter=%5B%5D&sort=%7B%22columnType%22:%22date%22,%22sortOrder%22:%22DESCENDING%22%7D", "youtube.com"],
    ["LinkedIn", "https://www.linkedin.com/feed/"],
    ["Quora", "https://www.quora.com/profile/TnJ-Ai-Services"],
    ["TikTok", "https://www.tiktok.com/@tnjaiservices?lang=en"],
    ["X / Twitter", "https://x.com/thetnjcompany", "x.com"],
    ["Reddit", "https://www.reddit.com/user/thetnjcompany/"],
    ["Facebook", "https://www.facebook.com/"],
    ["Instagram", "https://www.instagram.com/thetnjcompany/"],
  ]},
];

// Sites the Uptime widget checks.
const SITES = [
  { name: "tnjwebdesign.ca", url: "https://tnjwebdesign.ca" },
  { name: "clientportal.ca", url: "https://clientportal.ca" },
  { name: "legacyproject.net", url: "https://legacyproject.net" },
];

// Weather location and clock time zone.
const WEATHER = { lat: 43.65, lon: -79.38, label: "Toronto, Ontario" };
const TIME_ZONE = "America/Toronto";

// Tasks shown the very first time (after that, the board is remembered on this device).
const DEFAULT_TASKS = {
  todo: ["Update DNS", "Client follow-up"],
  progress: ["Website deployment"],
  done: ["SSL renewal"],
};

const UPTIME_RECHECK_MS = 5 * 60 * 1000;
const WEATHER_REFRESH_MS = 15 * 60 * 1000;


/* ==========================================================================
   2. HELPERS
   ========================================================================== */

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function storageGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: ignore */ }
}


/* ==========================================================================
   3. CLOCK (runs all the time; only visible after unlock)
   ========================================================================== */

function updateClock() {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, month: "2-digit", day: "2-digit", year: "numeric" })
    .format(now).replace(/\//g, "-");
  const time = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .format(now);
  const zulu = now.toISOString().split("T")[1].split(".")[0] + "Z";
  $("#clock").innerHTML = `<b>${esc(time)}</b><br>${esc(date)} | ${esc(zulu)}`;
}
updateClock();
setInterval(updateClock, 1000);


/* ==========================================================================
   4. THEME + TABS
   ========================================================================== */

function setTheme(mode) {
  document.documentElement.classList.toggle("light", mode === "light");
  try { localStorage.setItem("tj_theme", mode); } catch { /* ignore */ }
}
function toggleTheme() {
  setTheme(document.documentElement.classList.contains("light") ? "dark" : "light");
}
$("#theme-btn").addEventListener("click", toggleTheme);

function showView(name) {
  for (const tab of $$(".tab")) tab.setAttribute("aria-selected", String(tab.dataset.view === name));
  $("#view-dashboard").hidden = name !== "dashboard";
  $("#view-inventory").hidden = name !== "inventory";
  window.scrollTo({ top: 0 });
}

document.addEventListener("click", (e) => {
  const target = e.target.closest("[data-view], [data-goto]");
  if (!target) return;
  showView(target.dataset.view || target.dataset.goto);
});


/* ==========================================================================
   5. APP LAUNCHER
   ========================================================================== */

function renderApps() {
  $("#apps").innerHTML = APPS.map((group) => `
    <div class="category">
      <h2 class="category-title">${esc(group.title)}</h2>
      <div class="app-grid">
        ${group.items.map(([name, url, domain]) => `
          <a class="app-card" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
            <img src="https://www.google.com/s2/favicons?domain=${esc(domain || hostOf(url))}&sz=64" alt="" width="28" height="28" loading="lazy">
            <span class="app-name">${esc(name)}</span>
          </a>`).join("")}
      </div>
    </div>`).join("");
}


/* ==========================================================================
   6. STOCK ALERT WIDGET (fed by app.js)
   ========================================================================== */

document.addEventListener("inventory:stats", (e) => {
  const s = e.detail;

  $("#w-items").textContent = s.loaded ? s.items.toLocaleString() : "—";
  $("#w-units").textContent = s.loaded ? s.units.toLocaleString() : "—";
  $("#w-low").textContent = s.loaded ? s.low.toLocaleString() : "—";

  // Up to five stars, one per item that is low or out.
  const lit = s.loaded ? Math.min(5, s.low) : 0;
  $("#w-stars").innerHTML = Array.from({ length: 5 }, (_, i) => `<span class="star${i < lit ? " on" : ""}">&#9733;</span>`).join("");
  $("#w-stars").setAttribute("aria-label", `Stock alert level ${lit} of 5`);

  const list = $("#w-alerts");
  if (!s.loaded) {
    list.innerHTML = `<li class="alert-empty">${s.error ? "Inventory couldn't load." : "Loading inventory…"}</li>`;
  } else if (!s.alerts.length) {
    list.innerHTML = `<li class="alert-empty">Everything is above its low-stock level.</li>`;
  } else {
    list.innerHTML = s.alerts.map((a) =>
      `<li class="${a.status}"><span class="a-name">${esc(a.name)}</span><span class="a-qty">${a.quantity} left</span></li>`).join("");
  }
});


/* ==========================================================================
   7. WEATHER
   ========================================================================== */

const WEATHER_CODES = [
  [[0], "Clear"], [[1, 2, 3], "Cloudy"], [[45, 48], "Fog"],
  [[51, 53, 55, 56, 57], "Drizzle"], [[61, 63, 65, 66, 67], "Rain"],
  [[71, 73, 75, 77, 85, 86], "Snow"], [[80, 81, 82], "Showers"], [[95, 96, 99], "Thunderstorm"],
];
function weatherLabel(code) {
  const hit = WEATHER_CODES.find(([codes]) => codes.includes(code));
  return hit ? hit[1] : "";
}

async function loadWeather() {
  const box = $("#weather");
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER.lat}&longitude=${WEATHER.lon}&current_weather=true`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { current_weather: w } = await response.json();
    box.innerHTML = `
      <div class="weather-temp">${Math.round(w.temperature)}°C</div>
      <p class="w-cond">${esc(weatherLabel(w.weathercode))}</p>
      <p>Wind ${esc(w.windspeed)} km/h</p>
      <p>${esc(WEATHER.label)}</p>`;
  } catch (err) {
    console.error("Weather failed:", err);
    box.textContent = "Couldn't load the weather. Check your connection.";
  }
}


/* ==========================================================================
   8. TASK BOARD (saved on this device; drag cards between columns)
   ========================================================================== */

const TASK_KEY = "tj_tasks";
const COLUMNS = ["todo", "progress", "done"];

function taskHtml(text) {
  return `<div class="task"><span class="task-text">${esc(text)}</span><button class="task-del" type="button" aria-label="Delete task">&times;</button></div>`;
}

function saveTasks() {
  const data = {};
  for (const col of COLUMNS) data[col] = $$(`#${col} .task-text`).map((el) => el.textContent);
  storageSet(TASK_KEY, data);
}

let sortablesReady = false;

/** Fill the board from storage. Drag-and-drop is attached only once. */
function initTasks() {
  const data = storageGet(TASK_KEY, DEFAULT_TASKS);
  for (const col of COLUMNS) {
    const el = $(`#${col}`);
    el.innerHTML = (data[col] || []).map(taskHtml).join("");

    if (window.Sortable && !sortablesReady) {
      new window.Sortable(el, {
        group: "tasks",
        animation: 150,
        delay: 150,
        delayOnTouchOnly: true,   // on phones, press and hold to drag so scrolling still works
        filter: ".task-del",
        preventOnFilter: false,
        onEnd: saveTasks,
      });
    }
  }
  sortablesReady = Boolean(window.Sortable);
}

// These listeners are attached once, at load.
$("#task-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("#task-input");
  const text = input.value.trim();
  if (!text) return;
  $("#todo").insertAdjacentHTML("beforeend", taskHtml(text));
  input.value = "";
  saveTasks();
});

$(".board").addEventListener("click", (e) => {
  const del = e.target.closest(".task-del");
  if (!del) return;
  del.closest(".task").remove();
  saveTasks();
});


/* ==========================================================================
   9. UPTIME
   A browser can only tell whether a site answers, not read its response, so
   "Online" means the site responded; "Unreachable" means it didn't.
   ========================================================================== */

async function pingSite(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    await fetch(url, { mode: "no-cors", cache: "no-store", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function renderUptime() {
  $("#uptime").innerHTML = SITES.map((site, i) => `
    <li data-i="${i}" data-state="checking">
      <span class="up-dot" aria-hidden="true"></span>
      <span class="up-name">${esc(site.name)}</span>
      <span class="up-state">Checking</span>
    </li>`).join("");
}

async function checkSites() {
  const items = $$("#uptime li");
  items.forEach((li) => { li.dataset.state = "checking"; li.querySelector(".up-state").textContent = "Checking"; });
  await Promise.all(SITES.map(async (site, i) => {
    const up = await pingSite(site.url);
    const li = items[i];
    if (!li) return;
    li.dataset.state = up ? "up" : "down";
    li.querySelector(".up-state").textContent = up ? "Online" : "Unreachable";
  }));
}
$("#uptime-refresh").addEventListener("click", checkSites);


/* ==========================================================================
   10. COMMAND CONSOLE (typed or spoken)
   This is a command box, not an AI chat: it understands the commands in
   "help" below and nothing else.
   ========================================================================== */

const consoleEl = $("#console");

function openConsole(open = true) {
  consoleEl.classList.toggle("open", open);
  consoleEl.setAttribute("aria-hidden", String(!open));
  if (open) $("#console-input").focus();
}
$("#cmd-btn").addEventListener("click", () => openConsole(!consoleEl.classList.contains("open")));
$("#console-close").addEventListener("click", () => openConsole(false));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") openConsole(false); });

function logLine(who, text) {
  const p = document.createElement("p");
  p.className = `log-line ${who === "You" ? "you" : ""}`;
  const label = document.createElement("span");
  label.className = "who";
  label.textContent = who;
  p.append(label, document.createTextNode(text));
  const log = $("#console-log");
  log.append(p);
  log.scrollTop = log.scrollHeight;
}

function setLowOnly(on) {
  const box = $("#low-only");
  box.checked = on;
  box.dispatchEvent(new Event("change", { bubbles: true }));
}

function findApp(query) {
  const q = query.replace(/^(open|go to|launch|start)\s+/, "").trim();
  if (q.length < 2) return null;
  for (const group of APPS) {
    for (const [name, url] of group.items) {
      const n = name.toLowerCase();
      if (n.includes(q) || q.includes(n)) return { name, url };
    }
  }
  return null;
}

function runCommand(raw) {
  const text = raw.trim().toLowerCase();
  if (!text) return null;

  if (/^help\b|what can you do/.test(text)) {
    return "Commands: dashboard · inventory · low stock · dark mode · light mode · lock · check sites · open <app name> (for example, open github).";
  }
  if (/low|out of stock|alert/.test(text) && /stock|alert|item/.test(text)) {
    showView("inventory"); setLowOnly(true);
    return "Showing low-stock items.";
  }
  if (/inventory|stock|items/.test(text)) { showView("inventory"); return "Opening inventory."; }
  if (/dashboard|home/.test(text)) { showView("dashboard"); return "Opening the dashboard."; }
  if (/dark/.test(text)) { setTheme("dark"); return "Dark theme on."; }
  if (/light|bright/.test(text)) { setTheme("light"); return "Light theme on."; }
  if (/theme/.test(text)) { toggleTheme(); return "Theme switched."; }
  if (/uptime|check sites|sites/.test(text)) { showView("dashboard"); checkSites(); return "Checking your sites."; }
  if (/\block\b|log ?out|sign ?out/.test(text)) { $("#lock-btn").click(); return "Locking."; }

  const app = findApp(text);
  if (app) {
    const win = window.open(app.url, "_blank", "noopener");
    return win ? `Opening ${app.name}.` : `Your browser blocked the pop-up for ${app.name}. Use its card on the dashboard instead.`;
  }
  return "I don't know that command. Type help to see the list.";
}

function handleCommand(raw) {
  const reply = runCommand(raw);
  if (reply === null) return;
  logLine("You", raw.trim());
  logLine("Console", reply);
}

$("#console-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("#console-input");
  handleCommand(input.value);
  input.value = "";
});

/* Voice input (Chrome, Edge and Safari support it; the button hides if unsupported) */
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Recognition) {
  const voiceBtn = $("#voice-btn");
  voiceBtn.hidden = false;
  voiceBtn.addEventListener("click", () => {
    const rec = new Recognition();
    rec.lang = "en-US";
    rec.interimResults = false;
    voiceBtn.classList.add("is-listening");
    rec.onresult = (event) => { openConsole(true); handleCommand(event.results[0][0].transcript); };
    rec.onerror = (event) => { openConsole(true); logLine("Console", `Voice input failed (${event.error}).`); };
    rec.onend = () => voiceBtn.classList.remove("is-listening");
    try { rec.start(); } catch { voiceBtn.classList.remove("is-listening"); }
  });
}


/* ==========================================================================
   11. START / STOP WITH THE LOCK SCREEN
   Nothing below runs (no weather, no site pings) until you unlock.
   ========================================================================== */

let started = false;
let timers = [];

renderApps();
renderUptime();

document.addEventListener("app:unlocked", () => {
  showView("dashboard");
  if (started) return;
  started = true;

  initTasks();
  loadWeather();
  checkSites();
  timers = [setInterval(loadWeather, WEATHER_REFRESH_MS), setInterval(checkSites, UPTIME_RECHECK_MS)];
});

document.addEventListener("app:locked", () => {
  openConsole(false);
  timers.forEach(clearInterval);
  timers = [];
  started = false;
});
