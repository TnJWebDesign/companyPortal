/* ==========================================================================
   Inventory Tracker — app.js
   Vanilla JavaScript (ES module). No build step. Data lives in Firebase
   Firestore so every device stays in sync in real time.
   ========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  initializeAuth,
  browserSessionPersistence,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";


/* ==========================================================================
   1. CONFIGURATION — edit this section
   ========================================================================== */

// Paste the config from: Firebase console > Project settings > Your apps > Web app.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDlhwpoCJXhA-_VsB04lLdO2q9x0St_i7A",
  authDomain: "inventory-tnj.firebaseapp.com",
  projectId: "inventory-tnj",
  storageBucket: "inventory-tnj.firebasestorage.app",
  messagingSenderId: "127092348532",
  appId: "1:127092348532:web:8da5c1da666613a2ab2321",
};

// SHA-256 hash (hex) of your password. NEVER put the plain password here.
// The value below is the hash of "changeme" — replace it (see README for how).
const PASSWORD_HASH = "ca29af858801073d70b2f13b54cfdede4cb27c8409adf41ab602292ea801c770";

// Optional: server-enforced protection with Firebase Auth (see README, "Bonus").
// When true, the lock screen signs in to Firebase Auth with AUTH_EMAIL and the
// password you type, and PASSWORD_HASH is ignored.
const USE_FIREBASE_AUTH = false;
const AUTH_EMAIL = "inventory@example.com";

// Firestore collection that holds the items.
const COLLECTION = "inventory";

// -------------------------------------------------------------------------
const DEFAULT_PASSWORD_HASH = "057ba03d6c44104863dc7361fe4578965d1887360f90a0895882e58a6248fc86";
const SESSION_KEY = "inventory_unlocked";
const FIREBASE_CONFIGURED = !Object.values(FIREBASE_CONFIG).some((v) => String(v).includes("YOUR_"));


/* ==========================================================================
   2. SMALL HELPERS
   ========================================================================== */

const $ = (selector) => document.querySelector(selector);

/** Escape text before putting it into innerHTML (prevents HTML injection). */
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

/** SHA-256 of a string, returned as a lowercase hex string. */
async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Handy for generating your hash: open the page, press F12, run  hashPassword("my password")
window.hashPassword = (text) => sha256Hex(text).then((h) => { console.log(h); return h; });

/** "5 min ago", "2 days ago", or a short date for older changes. */
function timeAgo(date) {
  if (!date) return "—";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Turn a Firebase error into a message a person can act on. */
function friendlyError(err) {
  switch (err && err.code) {
    case "permission-denied":
      return "Firestore refused this request. Check your security rules (see README).";
    case "unavailable":
      return "Can't reach the server right now. Changes will sync when you're back online.";
    case "unauthenticated":
      return "You're signed out. Lock and unlock the app, then try again.";
    case "resource-exhausted":
      return "The free Firestore quota for today is used up. Try again tomorrow.";
    case "failed-precondition":
      return "Firestore isn't ready. Make sure you created a Firestore database in your project.";
    default:
      return (err && err.message) ? err.message : "Something went wrong. Please try again.";
  }
}

let toastTimer;
function toast(message, isError = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("is-error", isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 6000 : 3000);
}


/* ==========================================================================
   3. FIREBASE
   ========================================================================== */

let db = null;
let auth = null;
let unsubscribe = null; // stops the live Firestore listener

function initFirebase() {
  if (db) return;
  const app = initializeApp(FIREBASE_CONFIG);

  // Offline cache: edits made without a connection are queued and sent later.
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (err) {
    console.warn("Offline cache unavailable, using memory cache:", err);
    db = getFirestore(app);
  }

  if (USE_FIREBASE_AUTH) {
    // The sign-in lasts for the browser tab session, like the password gate.
    auth = initializeAuth(app, { persistence: browserSessionPersistence });
  }
}


/* ==========================================================================
   4. STATE
   ========================================================================== */

const state = {
  items: [],
  loaded: false,       // first snapshot received
  error: null,         // last listener error
  fromCache: true,
  hasPending: false,
  search: "",
  category: "",
  lowOnly: false,
};

/** "out" = 0 units, "low" = at or below threshold, otherwise "ok". */
function statusOf(item) {
  if (item.quantity <= 0) return "out";
  if (item.quantity <= item.threshold) return "low";
  return "ok";
}
const STATUS_LABEL = { ok: "In stock", low: "Low stock", out: "Out of stock" };

/** Convert a Firestore document into a clean item object. */
function normalize(id, data) {
  const ts = data.lastUpdated && typeof data.lastUpdated.toDate === "function" ? data.lastUpdated.toDate() : null;
  return {
    id,
    name: String(data.name ?? "Untitled"),
    sku: String(data.sku ?? ""),
    category: String(data.category ?? ""),
    quantity: Math.max(0, Number(data.quantity) || 0),
    threshold: Math.max(0, Number(data.threshold) || 0),
    notes: String(data.notes ?? ""),
    lastUpdated: ts,
  };
}


/* ==========================================================================
   5. LIVE SYNC
   ========================================================================== */

function setSync(stateName, label) {
  const el = $("#sync");
  el.dataset.state = stateName;
  $("#sync-label").textContent = label;
}

function updateSyncIndicator() {
  if (state.error) return setSync("error", FIREBASE_CONFIGURED ? "Sync error" : "Not set up");
  if (!navigator.onLine) return setSync("offline", "Offline");
  if (!state.loaded || state.fromCache) return setSync("connecting", "Connecting…");
  if (state.hasPending) return setSync("syncing", "Syncing…");
  setSync("synced", "Synced");
}

function startListening() {
  if (unsubscribe) return;

  if (!FIREBASE_CONFIGURED) {
    state.error = { code: "not-configured", message: "Firebase isn't set up yet. Add your project details to FIREBASE_CONFIG in app.js." };
    render();
    return;
  }

  initFirebase();
  state.error = null;
  state.loaded = false;
  render();

  unsubscribe = onSnapshot(
    collection(db, COLLECTION),
    { includeMetadataChanges: true },
    (snapshot) => {
      state.items = snapshot.docs.map((d) => normalize(d.id, d.data({ serverTimestamps: "estimate" })));
      state.loaded = true;
      state.error = null;
      state.fromCache = snapshot.metadata.fromCache;
      state.hasPending = snapshot.metadata.hasPendingWrites;
      render();
    },
    (err) => {
      console.error("Firestore listener error:", err);
      state.error = err;
      render();
    }
  );
}

function stopListening() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  state.items = [];
  state.loaded = false;
  state.error = null;
  state.fromCache = true;
  state.hasPending = false;
}

window.addEventListener("online", updateSyncIndicator);
window.addEventListener("offline", updateSyncIndicator);


/* ==========================================================================
   6. WRITING DATA
   Writes are not awaited by the UI: Firestore applies them locally at once
   (so the screen updates instantly) and uploads them in the background.
   ========================================================================== */

function reportWriteError(err) {
  console.error("Write failed:", err);
  toast(friendlyError(err), true);
}

/** Quick +1 / -1. Quantity never goes below zero. */
function adjustQuantity(id, delta) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  const next = Math.max(0, item.quantity + delta);
  if (next === item.quantity) return;

  updateDoc(doc(db, COLLECTION, id), { quantity: next, lastUpdated: serverTimestamp() })
    .catch(reportWriteError);
}

function saveItem(id, data) {
  if (!id) {
    addDoc(collection(db, COLLECTION), {
      ...data,
      createdAt: serverTimestamp(),
      lastUpdated: serverTimestamp(),
    }).catch(reportWriteError);
    return;
  }

  const existing = state.items.find((i) => i.id === id);
  const patch = { ...data };
  // Only touch lastUpdated when the quantity actually changed.
  if (!existing || existing.quantity !== data.quantity) patch.lastUpdated = serverTimestamp();
  updateDoc(doc(db, COLLECTION, id), patch).catch(reportWriteError);
}

function removeItem(id) {
  deleteDoc(doc(db, COLLECTION, id)).catch(reportWriteError);
}


/* ==========================================================================
   7. RENDERING
   ========================================================================== */

let categoryKey = ""; // remembers the current category list so we only rebuild the dropdown when it changes

function visibleItems() {
  const q = state.search.trim().toLowerCase();
  return state.items
    .filter((item) => {
      if (state.category && item.category !== state.category) return false;
      if (state.lowOnly && statusOf(item) === "ok") return false;
      if (q && !item.name.toLowerCase().includes(q) && !item.sku.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function renderSummary() {
  const items = state.items;
  const units = items.reduce((sum, i) => sum + i.quantity, 0);
  const low = items.filter((i) => statusOf(i) !== "ok").length;
  const out = items.filter((i) => statusOf(i) === "out").length;

  $("#stat-items").textContent = items.length.toLocaleString();
  $("#stat-units").textContent = units.toLocaleString();
  $("#stat-low").textContent = low.toLocaleString();
  $("#stat-out-note").textContent = out ? `(${out} out)` : "";
  $("#stat-low-box").classList.toggle("has-low", low > 0);

  // Tell the dashboard (portal.js) so its "Stock alert" widget stays current.
  const alerts = items
    .filter((i) => statusOf(i) !== "ok")
    .sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name))
    .slice(0, 4)
    .map((i) => ({ name: i.name, quantity: i.quantity, status: statusOf(i) }));
  document.dispatchEvent(new CustomEvent("inventory:stats", {
    detail: { loaded: state.loaded && !state.error, error: Boolean(state.error), items: items.length, units, low, out, alerts },
  }));
}

/** Keep the category filter + the form's suggestion list in sync with the data. */
function renderCategories() {
  const categories = [...new Set(state.items.map((i) => i.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const key = categories.join("\u0000");
  if (key === categoryKey) return;
  categoryKey = key;

  if (state.category && !categories.includes(state.category)) state.category = "";

  const select = $("#category-filter");
  select.innerHTML = `<option value="">All categories</option>` +
    categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  select.value = state.category;

  $("#category-list").innerHTML = categories.map((c) => `<option value="${esc(c)}"></option>`).join("");
}

function showStateBox(html, extraClass = "") {
  const box = $("#state-box");
  box.className = `state-box ${extraClass}`.trim();
  box.innerHTML = html;
  box.hidden = false;
}

function badge(item) {
  const s = statusOf(item);
  return `<span class="badge badge-${s}">${STATUS_LABEL[s]}</span>`;
}

function stepper(item) {
  return `
    <div class="stepper">
      <button class="step-btn" type="button" data-action="dec" ${item.quantity <= 0 ? "disabled" : ""}
              aria-label="Remove one ${esc(item.name)}">&minus;</button>
      <span class="qty" aria-label="Quantity ${item.quantity}">${item.quantity}</span>
      <button class="step-btn" type="button" data-action="inc" aria-label="Add one ${esc(item.name)}">+</button>
    </div>`;
}

function updatedCell(item) {
  const full = item.lastUpdated ? item.lastUpdated.toLocaleString() : "";
  return `<span class="updated" title="${esc(full)}">${timeAgo(item.lastUpdated)}</span>`;
}

function actionButtons(item) {
  return `
    <div class="row-actions">
      <button class="btn btn-ghost btn-small" type="button" data-action="edit" aria-label="Edit ${esc(item.name)}">Edit</button>
      <button class="btn btn-ghost btn-small" type="button" data-action="delete" aria-label="Delete ${esc(item.name)}">Delete</button>
    </div>`;
}

function metaLine(item) {
  return [item.sku && `SKU ${esc(item.sku)}`, item.category && esc(item.category)].filter(Boolean).join(" · ");
}

function rowHtml(item) {
  return `
    <tr class="status-${statusOf(item)}" data-id="${esc(item.id)}">
      <td>
        <div class="item-name">${esc(item.name)}</div>
        ${item.notes ? `<div class="item-notes">${esc(item.notes)}</div>` : ""}
      </td>
      <td>${esc(item.sku) || "—"}</td>
      <td>${esc(item.category) || "—"}</td>
      <td class="col-qty">${stepper(item)}</td>
      <td class="col-num">${item.threshold}</td>
      <td>${badge(item)}</td>
      <td>${updatedCell(item)}</td>
      <td>${actionButtons(item)}</td>
    </tr>`;
}

function cardHtml(item) {
  const meta = metaLine(item);
  return `
    <li class="card status-${statusOf(item)}" data-id="${esc(item.id)}">
      <div class="card-top">
        <div>
          <div class="item-name">${esc(item.name)}</div>
          ${meta ? `<div class="item-meta">${meta}</div>` : ""}
        </div>
        ${badge(item)}
      </div>
      <div class="card-mid">
        ${stepper(item)}
        <div class="card-low-at">Low at ${item.threshold}</div>
      </div>
      ${item.notes ? `<div class="item-notes">${esc(item.notes)}</div>` : ""}
      <div class="card-bottom">
        ${updatedCell(item)}
        ${actionButtons(item)}
      </div>
    </li>`;
}

function render() {
  updateSyncIndicator();
  renderSummary();
  renderCategories();

  const tableWrap = $("#table-wrap");
  const cards = $("#cards");
  const box = $("#state-box");
  tableWrap.hidden = true;
  cards.hidden = true;
  box.hidden = true;

  // Error
  if (state.error) {
    showStateBox(`
      <h2 class="state-title">Can't load your inventory</h2>
      <p class="state-text">${esc(friendlyError(state.error))}</p>
      ${state.error.code === "not-configured" ? "" : `<button class="btn btn-ghost" type="button" data-action="retry">Try again</button>`}
    `, "is-error");
    return;
  }

  // Loading
  if (!state.loaded) {
    showStateBox(`<div class="spinner" aria-hidden="true"></div><p class="state-text">Loading inventory…</p>`);
    return;
  }

  // Nothing added yet
  if (state.items.length === 0) {
    showStateBox(`
      <h2 class="state-title">No items yet</h2>
      <p class="state-text">Add your first item to start tracking stock. Everything you add shows up on all your devices.</p>
      <button class="btn btn-primary" type="button" data-action="add-first">Add item</button>
    `);
    return;
  }

  // Filters hide everything
  const visible = visibleItems();
  if (visible.length === 0) {
    showStateBox(`
      <h2 class="state-title">No matching items</h2>
      <p class="state-text">Nothing fits the current search or filters.</p>
      <button class="btn btn-ghost" type="button" data-action="clear-filters">Clear filters</button>
    `);
    return;
  }

  // Normal list: both views are rendered, CSS decides which one is visible.
  $("#rows").innerHTML = visible.map(rowHtml).join("");
  cards.innerHTML = visible.map(cardHtml).join("");
  tableWrap.hidden = false;
  cards.hidden = false;
}

// Refresh the "5 min ago" labels once a minute.
setInterval(() => { if (!$("#app").hidden && state.loaded && !state.error) render(); }, 60000);


/* ==========================================================================
   8. EVENTS: LIST, TOOLBAR, DIALOGS
   ========================================================================== */

/* ---- Search & filters ---- */
$("#search").addEventListener("input", (e) => { state.search = e.target.value; render(); });
$("#category-filter").addEventListener("change", (e) => { state.category = e.target.value; render(); });
$("#low-only").addEventListener("change", (e) => { state.lowOnly = e.target.checked; render(); });

function clearFilters() {
  state.search = "";
  state.category = "";
  state.lowOnly = false;
  $("#search").value = "";
  $("#category-filter").value = "";
  $("#low-only").checked = false;
  render();
}

/* ---- Clicks inside the list, the state box, and the toolbar ---- */
function handleAction(e) {
  const button = e.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const row = button.closest("[data-id]");
  const id = row ? row.dataset.id : null;

  switch (action) {
    case "inc":   adjustQuantity(id, +1); break;
    case "dec":   adjustQuantity(id, -1); break;
    case "edit":  openItemDialog(state.items.find((i) => i.id === id)); break;
    case "delete": askDelete(state.items.find((i) => i.id === id)); break;
    case "add-first": openItemDialog(); break;
    case "clear-filters": clearFilters(); break;
    case "retry":
      stopListening();
      startListening();
      break;
  }
}
$("#rows").addEventListener("click", handleAction);
$("#cards").addEventListener("click", handleAction);
$("#state-box").addEventListener("click", handleAction);
$("#add-btn").addEventListener("click", () => openItemDialog());

/* ---- Add / edit dialog ---- */
const itemDialog = $("#item-dialog");
const itemForm = $("#item-form");
let editingId = null;

function openItemDialog(item) {
  editingId = item ? item.id : null;
  $("#item-dialog-title").textContent = item ? "Edit item" : "Add item";
  $("#f-name").value = item ? item.name : "";
  $("#f-sku").value = item ? item.sku : "";
  $("#f-category").value = item ? item.category : (state.category || "");
  $("#f-quantity").value = item ? item.quantity : 0;
  $("#f-threshold").value = item ? item.threshold : 5;
  $("#f-notes").value = item ? item.notes : "";
  $("#item-form-error").hidden = true;
  itemDialog.showModal();
  $("#f-name").focus();
}

$("#item-cancel").addEventListener("click", () => itemDialog.close());

itemForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const name = $("#f-name").value.trim();
  const quantity = Number($("#f-quantity").value);
  const threshold = Number($("#f-threshold").value);
  const errorEl = $("#item-form-error");

  let problem = "";
  if (!name) problem = "Enter an item name.";
  else if (!Number.isInteger(quantity) || quantity < 0) problem = "Quantity must be a whole number, 0 or more.";
  else if (!Number.isInteger(threshold) || threshold < 0) problem = "Low-stock threshold must be a whole number, 0 or more.";

  if (problem) {
    errorEl.textContent = problem;
    errorEl.hidden = false;
    return;
  }

  saveItem(editingId, {
    name,
    sku: $("#f-sku").value.trim(),
    category: $("#f-category").value.trim(),
    quantity,
    threshold,
    notes: $("#f-notes").value.trim(),
  });
  itemDialog.close();
  toast(editingId ? "Item saved." : "Item added.");
});

/* ---- Delete confirmation ---- */
const confirmDialog = $("#confirm-dialog");
let deletingId = null;

function askDelete(item) {
  if (!item) return;
  deletingId = item.id;
  $("#confirm-text").textContent = `"${item.name}" will be removed from every device. This can't be undone.`;
  confirmDialog.showModal();
}
$("#confirm-cancel").addEventListener("click", () => confirmDialog.close());
$("#confirm-ok").addEventListener("click", () => {
  if (deletingId) removeItem(deletingId);
  deletingId = null;
  confirmDialog.close();
  toast("Item deleted.");
});

// Clicking the dark backdrop closes a dialog.
for (const dialog of [itemDialog, confirmDialog]) {
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
}


/* ==========================================================================
   9. PASSWORD LOCK
   ========================================================================== */

function showLockScreen() {
  document.dispatchEvent(new Event("app:locked"));
  $("#app").hidden = true;
  $("#lock-screen").hidden = false;
  $("#lock-input").value = "";
  $("#lock-error").hidden = true;

  const notice = $("#lock-notice");
  if (!FIREBASE_CONFIGURED) {
    notice.textContent = "Firebase isn't set up yet. Add your project details to FIREBASE_CONFIG in app.js.";
    notice.hidden = false;
  } else {
    notice.hidden = true;
  }
  $("#lock-input").focus();
}

function showApp() {
  $("#lock-screen").hidden = true;
  $("#app").hidden = false;
  $("#default-pw-banner").hidden = USE_FIREBASE_AUTH || PASSWORD_HASH !== DEFAULT_PASSWORD_HASH;
  document.dispatchEvent(new Event("app:unlocked"));
  startListening();
}

function showLockError(message) {
  const el = $("#lock-error");
  el.textContent = message;
  el.hidden = false;
}

$("#lock-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = $("#lock-input").value;
  if (!password) return;

  const submit = $("#lock-submit");
  submit.disabled = true;
  $("#lock-error").hidden = true;

  try {
    if (USE_FIREBASE_AUTH) {
      // Signing in triggers onAuthStateChanged below, which opens the app.
      if (!FIREBASE_CONFIGURED) throw new Error("Firebase isn't set up yet. Edit FIREBASE_CONFIG in app.js.");
      initFirebase();
      await signInWithEmailAndPassword(auth, AUTH_EMAIL, password);
    } else {
      if (!window.crypto || !crypto.subtle) {
        throw new Error("This page must be opened over HTTPS (or localhost) so the password can be checked.");
      }
      const hash = await sha256Hex(password);
      if (hash === PASSWORD_HASH) {
        sessionStorage.setItem(SESSION_KEY, "1");
        showApp();
      } else {
        showLockError("Wrong password. Try again.");
        $("#lock-input").select();
      }
    }
  } catch (err) {
    console.error(err);
    const wrong = err && (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/invalid-login-credentials");
    showLockError(wrong ? "Wrong password. Try again." : friendlyAuthError(err));
  } finally {
    submit.disabled = false;
  }
});

function friendlyAuthError(err) {
  switch (err && err.code) {
    case "auth/too-many-requests":   return "Too many attempts. Wait a few minutes and try again.";
    case "auth/network-request-failed": return "No connection. Check your internet and try again.";
    case "auth/user-not-found":      return "That sign-in account doesn't exist. Check AUTH_EMAIL and your Firebase users.";
    case "auth/operation-not-allowed": return "Email/Password sign-in isn't turned on in Firebase Authentication.";
    default: return (err && err.message) || "Couldn't unlock. Please try again.";
  }
}

function lock() {
  sessionStorage.removeItem(SESSION_KEY);
  stopListening();
  if (USE_FIREBASE_AUTH && auth) signOut(auth).catch(console.error);
  showLockScreen();
}
$("#lock-btn").addEventListener("click", lock);


/* ==========================================================================
   10. START
   ========================================================================== */

if (USE_FIREBASE_AUTH && FIREBASE_CONFIGURED) {
  initFirebase();
  onAuthStateChanged(auth, (user) => {
    if (user) showApp();
    else { stopListening(); showLockScreen(); }
  });
} else if (!USE_FIREBASE_AUTH && sessionStorage.getItem(SESSION_KEY) === "1") {
  showApp();
} else {
  showLockScreen();
}
