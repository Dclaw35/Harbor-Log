const DB_NAME = "harbor-log-db";
const DB_VERSION = 1;
const ENTRY_STORE = "entries";
const SETTINGS_STORE = "settings";
const SETTINGS_KEY = "harbor-log-settings";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const DRIVE_FILE_NAME = "harbor-log-backup.json";

const moods = {
  low: { label: "Low", score: 2, color: "#466c86" },
  angry: { label: "Angry", score: 3, color: "#8b3f58" },
  anxious: { label: "Anxious", score: 4, color: "#b58535" },
  sad: { label: "Sad", score: 3, color: "#668a5b" },
  tender: { label: "Tender", score: 5, color: "#c46f7e" },
  steady: { label: "Steady", score: 6, color: "#153f46" },
  hopeful: { label: "Hopeful", score: 8, color: "#3f7f73" },
  bright: { label: "Bright", score: 9, color: "#d18c3d" }
};

const bookPalette = ["#153f46", "#466c86", "#8b3f58", "#668a5b", "#b58535", "#3f7f73", "#c46f7e"];
const ROOMS = ["write", "library", "insights"];

const state = {
  db: null,
  entries: [],
  settings: { googleClientId: "", lastDriveSync: "", libraryView: "shelf" },
  filters: { query: "", mood: "" },
  activeRoom: "write",
  geo: null,
  tokenClient: null
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  collectElements();
  bindEvents();
  setCurrentDateTime();
  try {
    state.db = await openDatabase();
    state.settings = Object.assign({}, state.settings, await readSettings());
    state.entries = await readAllEntries();
    hydrateSettings();
    setActiveRoom(roomFromHash(), { updateHash: false });
    setStatus("Ready. Stored in this browser.");
    await registerServiceWorker();
  } catch (error) {
    console.error(error);
    setStatus("Storage could not open. Export anything you write before closing.");
  }
  renderAll();
}

function collectElements() {
  Object.assign(els, {
    entryForm: document.querySelector("#entryForm"), entryId: document.querySelector("#entryId"), entryTitle: document.querySelector("#entryTitle"), entryDateTime: document.querySelector("#entryDateTime"), entryMood: document.querySelector("#entryMood"), entryIntensity: document.querySelector("#entryIntensity"), intensityValue: document.querySelector("#intensityValue"), entryBody: document.querySelector("#entryBody"), entryLocation: document.querySelector("#entryLocation"), entryPeople: document.querySelector("#entryPeople"), entryTags: document.querySelector("#entryTags"), entryPanelTitle: document.querySelector("#entryPanelTitle"), formStatus: document.querySelector("#formStatus"), storageStatus: document.querySelector("#storageStatus"), searchInput: document.querySelector("#searchInput"), moodFilter: document.querySelector("#moodFilter"), shelfView: document.querySelector("#shelfView"), drawerView: document.querySelector("#drawerView"), statsGrid: document.querySelector("#statsGrid"), trendChart: document.querySelector("#trendChart"), trendRange: document.querySelector("#trendRange"), locationChart: document.querySelector("#locationChart"), tagChart: document.querySelector("#tagChart"), backupDialog: document.querySelector("#backupDialog"), backupStatus: document.querySelector("#backupStatus"), googleClientId: document.querySelector("#googleClientId"), importFile: document.querySelector("#importFile"), emptyTemplate: document.querySelector("#emptyTemplate"), roomFade: document.querySelector("#roomFade"), entryDialog: document.querySelector("#entryDialog"), entryDialogMood: document.querySelector("#entryDialogMood"), entryDialogTitle: document.querySelector("#entryDialogTitle"), entryDialogMeta: document.querySelector("#entryDialogMeta"), entryDialogBody: document.querySelector("#entryDialogBody"), entryDialogTags: document.querySelector("#entryDialogTags"), entryDialogEdit: document.querySelector("#entryDialogEdit")
  });
}

function bindEvents() {
  document.addEventListener("click", handleDocumentClick);
  window.addEventListener("hashchange", function () { const room = roomFromHash(); if (room !== state.activeRoom) showRoom(room); });
  els.entryForm.addEventListener("submit", handleEntrySubmit);
  els.entryIntensity.addEventListener("input", function () { els.intensityValue.textContent = els.entryIntensity.value; });
  els.searchInput.addEventListener("input", function () { state.filters.query = els.searchInput.value.trim().toLowerCase(); renderLibrary(); });
  els.moodFilter.addEventListener("change", function () { state.filters.mood = els.moodFilter.value; renderLibrary(); });
  els.importFile.addEventListener("change", handleImportFile);
}

async function handleDocumentClick(event) {
  const actionTarget = event.target.closest("[data-action]");
  const roomTarget = event.target.closest(".room-button[data-room], .brand[data-room]");
  const viewTarget = event.target.closest("[data-view]");
  const entryTarget = event.target.closest("[data-entry-id]");
  if (roomTarget) { event.preventDefault(); await showRoom(roomTarget.dataset.room); return; }
  if (viewTarget) { switchLibraryView(viewTarget.dataset.view); return; }
  if (entryTarget && !actionTarget) {
    const entry = state.entries.find(function (item) { return item.id === entryTarget.dataset.entryId; });
    if (entry) openEntryDetail(entry);
    return;
  }
  if (!actionTarget) return;
  const action = actionTarget.dataset.action;
  if (action === "new-entry") { resetForm(); await showRoom("write"); }
  if (action === "focus-search") { await showRoom("library"); window.requestAnimationFrame(function () { els.searchInput.focus(); }); }
  if (action === "reset-form") resetForm();
  if (action === "delete-entry") await deleteCurrentEntry();
  if (action === "use-location") await captureLocation();
  if (action === "edit-open-entry") {
    const entry = state.entries.find(function (item) { return item.id === actionTarget.dataset.entryId; });
    if (entry) { closeEntryDialog(); loadEntryIntoForm(entry); await showRoom("write"); }
  }
  if (action === "open-backup") openBackupDialog();
  if (action === "export-json") await exportJson();
  if (action === "save-settings") await saveSettingsFromDialog();
  if (action === "drive-push") await pushToDrive();
  if (action === "drive-pull") await pullFromDrive();
  if (action === "persist-storage") await requestPersistentStorage();
}

async function handleEntrySubmit(event) {
  event.preventDefault();
  if (!els.entryBody.value.trim()) { setFormStatus("Write the entry before saving."); return; }
  const now = new Date().toISOString();
  const existing = state.entries.find(function (entry) { return entry.id === els.entryId.value; });
  const createdAt = fromLocalInput(els.entryDateTime.value).toISOString();
  const title = cleanText(els.entryTitle.value) || defaultTitle(createdAt);
  const locationLabel = cleanText(els.entryLocation.value) || "Unplaced";
  const entry = {
    id: existing ? existing.id : createId(), createdAt: createdAt, updatedAt: now, deletedAt: "", title: title, body: els.entryBody.value.trim(), mood: els.entryMood.value, intensity: Number(els.entryIntensity.value), tags: parseList(els.entryTags.value), people: parseList(els.entryPeople.value), location: { label: locationLabel, lat: state.geo ? state.geo.lat : existing && existing.location ? existing.location.lat : null, lng: state.geo ? state.geo.lng : existing && existing.location ? existing.location.lng : null, accuracy: state.geo ? state.geo.accuracy : existing && existing.location ? existing.location.accuracy : null, source: state.geo ? "browser" : "manual" }, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "", utcOffsetMinutes: new Date(createdAt).getTimezoneOffset()
  };
  await saveEntry(entry);
  state.geo = null;
  resetForm();
  setFormStatus("Saved.");
  setStatus("Saved " + formatDateTime(entry.createdAt) + ".");
}

async function deleteCurrentEntry() {
  const entry = state.entries.find(function (item) { return item.id === els.entryId.value; });
  if (!entry) return;
  if (!window.confirm("Delete this log?")) return;
  const now = new Date().toISOString();
  await saveEntry(Object.assign({}, entry, { deletedAt: now, updatedAt: now }));
  resetForm();
  setFormStatus("Deleted.");
}

async function captureLocation() {
  if (!navigator.geolocation) { setFormStatus("Location is unavailable in this browser."); return; }
  if (!window.isSecureContext) { setFormStatus("Location needs localhost or HTTPS."); return; }
  setFormStatus("Finding location...");
  navigator.geolocation.getCurrentPosition(function (position) {
    const coords = position.coords;
    state.geo = { lat: roundCoord(coords.latitude), lng: roundCoord(coords.longitude), accuracy: Math.round(coords.accuracy) };
    if (!els.entryLocation.value.trim()) els.entryLocation.value = state.geo.lat + ", " + state.geo.lng;
    setFormStatus("Location added.");
  }, function () { setFormStatus("Location was not added."); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 });
}

function loadEntryIntoForm(entry) {
  els.entryId.value = entry.id; els.entryTitle.value = entry.title || ""; els.entryDateTime.value = toLocalInput(entry.createdAt); els.entryMood.value = entry.mood || "steady"; els.entryIntensity.value = entry.intensity || 5; els.intensityValue.textContent = els.entryIntensity.value; els.entryBody.value = entry.body || ""; els.entryLocation.value = entry.location && entry.location.label ? entry.location.label : ""; els.entryPeople.value = (entry.people || []).join(", "); els.entryTags.value = (entry.tags || []).join(", "); els.entryPanelTitle.textContent = "Edit entry"; document.querySelector('[data-action="delete-entry"]').classList.remove("hidden"); setFormStatus("Opened " + formatDateTime(entry.createdAt) + "."); window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetForm() {
  els.entryForm.reset(); els.entryId.value = ""; els.entryMood.value = "steady"; els.entryIntensity.value = 5; els.intensityValue.textContent = "5"; els.entryPanelTitle.textContent = "New entry"; document.querySelector('[data-action="delete-entry"]').classList.add("hidden"); state.geo = null; setCurrentDateTime(); setFormStatus("");
}

function roomFromHash() {
  const hash = (window.location.hash || "").replace("#", "");
  return ROOMS.includes(hash) ? hash : "write";
}

function showRoom(room, options) {
  if (!ROOMS.includes(room)) return Promise.resolve();
  if (room === state.activeRoom) {
    setActiveRoom(room, options || {});
    return Promise.resolve();
  }
  const settings = options || {};
  if (settings.transition === false || !els.roomFade) {
    setActiveRoom(room, settings);
    return Promise.resolve();
  }
  els.roomFade.classList.add("active");
  return new Promise(function (resolve) {
    window.setTimeout(function () {
      setActiveRoom(room, settings);
      window.scrollTo({ top: 0, behavior: "auto" });
      window.setTimeout(function () {
        els.roomFade.classList.remove("active");
        resolve();
      }, 130);
    }, 230);
  });
}

function setActiveRoom(room, options) {
  if (!ROOMS.includes(room)) return;
  state.activeRoom = room;
  document.body.dataset.room = room;
  document.querySelectorAll("[data-room-panel]").forEach(function (panel) { panel.classList.toggle("active", panel.dataset.roomPanel === room); });
  document.querySelectorAll(".room-button").forEach(function (button) {
    const isActive = button.dataset.room === room;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-current", isActive ? "page" : "false");
  });
  if (!options || options.updateHash !== false) history.replaceState(null, "", "#" + room);
}

function openEntryDetail(entry) {
  if (!els.entryDialog) { loadEntryIntoForm(entry); showRoom("write"); return; }
  const locationLabel = entry.location && entry.location.label ? entry.location.label : "Unplaced";
  const people = entry.people && entry.people.length ? entry.people.join(", ") : "";
  const meta = [formatDateTime(entry.createdAt), locationLabel, people].filter(Boolean);
  els.entryDialogMood.textContent = moodLabel(entry.mood) + " " + entry.intensity + "/10";
  els.entryDialogTitle.textContent = entry.title || defaultTitle(entry.createdAt);
  els.entryDialogMeta.innerHTML = meta.map(function (item) { return "<span>" + escapeHtml(item) + "</span>"; }).join("");
  els.entryDialogBody.textContent = entry.body || "";
  els.entryDialogTags.innerHTML = (entry.tags || []).map(function (tag) { return "<span>#" + escapeHtml(tag) + "</span>"; }).join("");
  els.entryDialogEdit.dataset.entryId = entry.id;
  if (typeof els.entryDialog.showModal === "function") els.entryDialog.showModal();
  else els.entryDialog.setAttribute("open", "open");
}

function closeEntryDialog() {
  if (!els.entryDialog) return;
  if (typeof els.entryDialog.close === "function" && els.entryDialog.open) els.entryDialog.close();
  else els.entryDialog.removeAttribute("open");
}

function renderAll() { renderLibrary(); renderStats(); renderTrendChart(); renderLocationChart(); renderTagChart(); }
function renderLibrary() { const entries = getFilteredEntries(); renderShelf(entries); renderDrawer(entries); applyLibraryView(); }

function renderShelf(entries) {
  els.shelfView.replaceChildren();
  if (!entries.length) { els.shelfView.append(emptyNode()); return; }
  groupByMonth(entries).forEach(function (group) {
    const shelf = document.createElement("section"); shelf.className = "shelf";
    const title = document.createElement("div"); title.className = "shelf-title"; title.innerHTML = "<h3>" + escapeHtml(group.label) + "</h3><span>" + group.entries.length + " logs</span>";
    const row = document.createElement("div"); row.className = "book-row";
    group.entries.forEach(function (entry, index) {
      const button = document.createElement("button"); button.type = "button"; button.className = "book"; button.dataset.entryId = entry.id; button.dataset.mood = entry.mood; button.style.setProperty("--book-color", getEntryColor(entry, index)); button.style.setProperty("--book-height", 122 + Math.min(72, entry.intensity * 7) + "px"); button.innerHTML = "<span class=\"book-title\">" + escapeHtml(entry.title) + "</span><span class=\"book-meta\">" + escapeHtml(moodLabel(entry.mood)) + "</span>"; row.append(button);
    });
    shelf.append(title, row); els.shelfView.append(shelf);
  });
}

function renderDrawer(entries) {
  els.drawerView.replaceChildren();
  if (!entries.length) { els.drawerView.append(emptyNode()); return; }
  groupByMonth(entries).forEach(function (group) {
    const section = document.createElement("section"); section.className = "drawer-group";
    const label = document.createElement("div"); label.className = "drawer-label"; label.innerHTML = "<h3>" + escapeHtml(group.label) + "</h3><span>" + group.entries.length + "</span>";
    const stack = document.createElement("div"); stack.className = "entry-stack"; group.entries.forEach(function (entry) { stack.append(entryCard(entry)); });
    section.append(label, stack); els.drawerView.append(section);
  });
}

function entryCard(entry) {
  const button = document.createElement("button"); button.type = "button"; button.className = "entry-card"; button.dataset.entryId = entry.id; button.style.setProperty("--entry-color", moodColor(entry.mood));
  let pills = "<span class=\"pill mood-pill\">" + escapeHtml(moodLabel(entry.mood)) + " " + entry.intensity + "/10</span>";
  if (entry.location && entry.location.label) pills += "<span class=\"pill\">" + escapeHtml(entry.location.label) + "</span>";
  (entry.tags || []).slice(0, 4).forEach(function (tag) { pills += "<span class=\"pill\">#" + escapeHtml(tag) + "</span>"; });
  button.innerHTML = "<div class=\"entry-card-title\"><span>" + escapeHtml(entry.title) + "</span><time datetime=\"" + escapeHtml(entry.createdAt) + "\">" + escapeHtml(shortDate(entry.createdAt)) + "</time></div><p>" + escapeHtml(entry.body) + "</p><div class=\"pill-row\">" + pills + "</div>";
  return button;
}

function renderStats() {
  const entries = visibleEntries();
  const thisWeek = entries.filter(function (entry) { return isWithinDays(entry.createdAt, 7); }).length;
  const avg = entries.length ? average(entries.map(moodScore)).toFixed(1) : "0";
  const commonTag = topItem(entries.flatMap(function (entry) { return entry.tags || []; })) || "None";
  const places = new Set(entries.map(function (entry) { return entry.location && entry.location.label ? entry.location.label : "Unplaced"; }));
  const sync = state.settings.lastDriveSync ? shortDate(state.settings.lastDriveSync) : "Not yet";
  const stats = [["Logs", entries.length], ["This week", thisWeek], ["Mood avg", avg], ["Top tag", commonTag], ["Places", places.size || 0], ["Drive sync", sync]];
  els.statsGrid.innerHTML = stats.map(function (stat) { return "<div class=\"stat-tile\"><span>" + escapeHtml(stat[0]) + "</span><strong>" + escapeHtml(String(stat[1])) + "</strong></div>"; }).join("");
}

function renderTrendChart() {
  const entries = visibleEntries().slice().sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
  if (!entries.length) { els.trendRange.textContent = ""; els.trendChart.innerHTML = miniEmpty("No mood points"); return; }
  const width = 620, height = 230, padding = 34, maxX = Math.max(1, entries.length - 1);
  const points = entries.map(function (entry, index) { const x = padding + index / maxX * (width - padding * 2); const y = height - padding - (moodScore(entry) - 1) / 9 * (height - padding * 2); return { x: x, y: y, entry: entry }; });
  const path = points.map(function (point, index) { return (index ? "L" : "M") + " " + point.x.toFixed(1) + " " + point.y.toFixed(1); }).join(" ");
  const area = path + " L " + points[points.length - 1].x.toFixed(1) + " " + (height - padding) + " L " + points[0].x.toFixed(1) + " " + (height - padding) + " Z";
  const dots = points.map(function (point) { return "<circle cx=\"" + point.x + "\" cy=\"" + point.y + "\" r=\"5.5\" fill=\"" + moodColor(point.entry.mood) + "\"><title>" + escapeHtml(point.entry.title) + ": " + escapeHtml(moodLabel(point.entry.mood)) + "</title></circle>"; }).join("");
  const ticks = [1, 3, 5, 7, 9].map(function (tick) { const y = height - padding - (tick - 1) / 9 * (height - padding * 2); return "<line x1=\"" + padding + "\" x2=\"" + (width - padding) + "\" y1=\"" + y + "\" y2=\"" + y + "\" stroke=\"rgba(22,36,42,.12)\"/><text x=\"8\" y=\"" + (y + 4) + "\" font-size=\"11\" fill=\"#64737a\">" + tick + "</text>"; }).join("");
  els.trendRange.textContent = entries.length === 1 ? shortDate(entries[0].createdAt) : shortDate(entries[0].createdAt) + " to " + shortDate(entries[entries.length - 1].createdAt);
  els.trendChart.innerHTML = "<svg viewBox=\"0 0 " + width + " " + height + "\" role=\"img\" aria-label=\"Mood over time chart\"><defs><linearGradient id=\"trendFill\" x1=\"0\" x2=\"0\" y1=\"0\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#466c86\" stop-opacity=\"0.24\"/><stop offset=\"100%\" stop-color=\"#b58535\" stop-opacity=\"0.05\"/></linearGradient></defs>" + ticks + "<path d=\"" + area + "\" fill=\"url(#trendFill)\"/><path d=\"" + path + "\" fill=\"none\" stroke=\"#153f46\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>" + dots + "</svg>";
}

function renderLocationChart() {
  const entries = visibleEntries();
  if (!entries.length) { els.locationChart.innerHTML = miniEmpty("No locations"); return; }
  const rows = aggregate(entries, function (entry) { return entry.location && entry.location.label ? entry.location.label : "Unplaced"; }).map(function (item) { return Object.assign({}, item, { avg: average(item.entries.map(moodScore)) }); }).sort(function (a, b) { return b.entries.length - a.entries.length; }).slice(0, 8);
  els.locationChart.innerHTML = rows.map(function (row, index) { const percent = Math.max(7, row.avg / 10 * 100); const color = bookPalette[index % bookPalette.length]; return "<div class=\"bar-row\"><span>" + escapeHtml(row.key) + "</span><div class=\"bar-track\"><div class=\"bar-fill\" style=\"width:" + percent + "%;--bar-color:" + color + "\"></div></div><span>" + row.avg.toFixed(1) + "</span></div>"; }).join("");
}

function renderTagChart() {
  const items = [];
  visibleEntries().forEach(function (entry) { (entry.tags || []).forEach(function (tag) { items.push({ tag: tag, entry: entry }); }); });
  if (!items.length) { els.tagChart.innerHTML = miniEmpty("No tags"); return; }
  const rows = aggregate(items, function (item) { return item.tag; }).map(function (item) { return { key: item.key, count: item.entries.length, avg: average(item.entries.map(function (itemEntry) { return moodScore(itemEntry.entry); })) }; }).sort(function (a, b) { return b.count - a.count || b.avg - a.avg; }).slice(0, 18);
  els.tagChart.innerHTML = rows.map(function (row, index) { const size = 0.76 + Math.min(0.28, row.count * 0.035); const bg = softColor(bookPalette[index % bookPalette.length]); return "<div class=\"tag-bubble\" style=\"font-size:" + size + "rem;--bubble-bg:" + bg + "\">#" + escapeHtml(row.key) + "<span>" + row.count + " / " + row.avg.toFixed(1) + "</span></div>"; }).join("");
}

function switchLibraryView(view) { state.settings.libraryView = view; writeSettings(state.settings); applyLibraryView(); }
function applyLibraryView() { const view = state.settings.libraryView || "shelf"; document.querySelectorAll("[data-view]").forEach(function (button) { button.classList.toggle("active", button.dataset.view === view); }); els.shelfView.classList.toggle("hidden", view !== "shelf"); els.drawerView.classList.toggle("hidden", view !== "drawer"); }
async function saveEntry(entry) { await writeEntry(entry); const index = state.entries.findIndex(function (item) { return item.id === entry.id; }); if (index >= 0) state.entries[index] = entry; else state.entries.push(entry); renderAll(); }
function getFilteredEntries() { const query = state.filters.query; return visibleEntries().filter(function (entry) { if (state.filters.mood && entry.mood !== state.filters.mood) return false; if (!query) return true; const haystack = [entry.title, entry.body, entry.mood, entry.location ? entry.location.label : ""].concat(entry.tags || [], entry.people || []).join(" ").toLowerCase(); return haystack.includes(query); }); }
function visibleEntries() { return state.entries.filter(function (entry) { return !entry.deletedAt; }).sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); }); }
function groupByMonth(entries) { const map = new Map(); entries.forEach(function (entry) { const date = new Date(entry.createdAt); const key = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0"); if (!map.has(key)) map.set(key, { key: key, label: date.toLocaleDateString([], { month: "long", year: "numeric" }), entries: [] }); map.get(key).entries.push(entry); }); return Array.from(map.values()).sort(function (a, b) { return b.key.localeCompare(a.key); }); }

async function exportJson() { const payload = await makeBackupPayload(); downloadJson(payload, "harbor-log-" + new Date().toISOString().slice(0, 10) + ".json"); setBackupStatus("Exported."); }
async function handleImportFile(event) { const file = event.target.files && event.target.files[0]; if (!file) return; try { const payload = JSON.parse(await file.text()); const result = await mergePayload(payload); setBackupStatus("Imported " + result.changed + " changes."); } catch (error) { console.error(error); setBackupStatus("Import failed."); } finally { event.target.value = ""; } }
function openBackupDialog() { hydrateSettings(); setBackupStatus(""); if (typeof els.backupDialog.showModal === "function") els.backupDialog.showModal(); else els.backupDialog.setAttribute("open", "open"); }
function hydrateSettings() { els.googleClientId.value = state.settings.googleClientId || ""; if (state.settings.lastDriveSync) setStatus("Last Drive sync " + formatDateTime(state.settings.lastDriveSync) + "."); }
async function saveSettingsFromDialog() { state.settings.googleClientId = els.googleClientId.value.trim(); await writeSettings(state.settings); setBackupStatus("Settings saved."); }

async function pushToDrive() {
  try { await saveSettingsFromDialog(); const token = await requestDriveToken(); const payload = await makeBackupPayload(); const existing = await findDriveFile(token); if (existing) await updateDriveFile(token, existing.id, payload); else await createDriveFile(token, payload); state.settings.lastDriveSync = new Date().toISOString(); await writeSettings(state.settings); renderStats(); setBackupStatus("Backed up to Google Drive."); setStatus("Drive backup " + formatDateTime(state.settings.lastDriveSync) + "."); }
  catch (error) { console.error(error); setBackupStatus(readableError(error)); }
}

async function pullFromDrive() {
  try { await saveSettingsFromDialog(); const token = await requestDriveToken(); const existing = await findDriveFile(token); if (!existing) { setBackupStatus("No Drive backup found."); return; } const payload = await downloadDriveFile(token, existing.id); const result = await mergePayload(payload); state.settings.lastDriveSync = new Date().toISOString(); await writeSettings(state.settings); renderStats(); setBackupStatus("Merged " + result.changed + " changes from Drive."); setStatus("Drive merge " + formatDateTime(state.settings.lastDriveSync) + "."); }
  catch (error) { console.error(error); setBackupStatus(readableError(error)); }
}

async function requestDriveToken() {
  if (!state.settings.googleClientId) throw new Error("Add your Google OAuth client ID first.");
  if (location.protocol === "file:") throw new Error("Drive sync needs localhost or HTTPS.");
  await loadGoogleIdentity();
  return new Promise(function (resolve, reject) {
    state.tokenClient = window.google.accounts.oauth2.initTokenClient({ client_id: state.settings.googleClientId, scope: DRIVE_SCOPE, callback: function (response) { if (response && response.error) { reject(new Error(response.error_description || response.error)); return; } resolve(response.access_token); } });
    state.tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

function loadGoogleIdentity() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
  return new Promise(function (resolve, reject) {
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) { existing.addEventListener("load", resolve, { once: true }); existing.addEventListener("error", function () { reject(new Error("Google sign-in script failed.")); }, { once: true }); return; }
    const script = document.createElement("script"); script.src = "https://accounts.google.com/gsi/client"; script.async = true; script.defer = true; script.onload = resolve; script.onerror = function () { reject(new Error("Google sign-in script failed.")); }; document.head.append(script);
  });
}
async function findDriveFile(token) { const params = new URLSearchParams({ spaces: "appDataFolder", q: "name='" + DRIVE_FILE_NAME + "'", fields: "files(id,name,modifiedTime)", orderBy: "modifiedTime desc", pageSize: "10" }); const response = await driveFetch(token, "https://www.googleapis.com/drive/v3/files?" + params.toString()); const data = await response.json(); return data.files && data.files[0] ? data.files[0] : null; }
async function createDriveFile(token, payload) { const metadata = { name: DRIVE_FILE_NAME, parents: ["appDataFolder"], mimeType: "application/json" }; const body = multipartBody(metadata, payload); await driveFetch(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime", { method: "POST", headers: { "Content-Type": body.contentType }, body: body.value }); }
async function updateDriveFile(token, fileId, payload) { await driveFetch(token, "https://www.googleapis.com/upload/drive/v3/files/" + encodeURIComponent(fileId) + "?uploadType=media&fields=id,name,modifiedTime", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload, null, 2) }); }
async function downloadDriveFile(token, fileId) { const response = await driveFetch(token, "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media"); return response.json(); }
async function driveFetch(token, url, options) { const requestOptions = options || {}; const response = await fetch(url, Object.assign({}, requestOptions, { headers: Object.assign({}, requestOptions.headers || {}, { Authorization: "Bearer " + token }) })); if (!response.ok) { const message = await response.text(); throw new Error(message || "Drive request failed: " + response.status); } return response; }
function multipartBody(metadata, payload) { const boundary = "harbor_log_" + createId().replace(/[^a-zA-Z0-9]/g, ""); const value = ["--" + boundary, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify(metadata), "--" + boundary, "Content-Type: application/json", "", JSON.stringify(payload, null, 2), "--" + boundary + "--", ""].join("\r\n"); return { contentType: "multipart/related; boundary=" + boundary, value: value }; }
async function makeBackupPayload() { return { app: "Harbor Log", schemaVersion: 1, exportedAt: new Date().toISOString(), entries: state.entries, settings: { lastDriveSync: state.settings.lastDriveSync || "", libraryView: state.settings.libraryView || "shelf" } }; }
async function mergePayload(payload) { if (!payload || !Array.isArray(payload.entries)) throw new Error("That file is not a Harbor Log backup."); let changed = 0; const byId = new Map(state.entries.map(function (entry) { return [entry.id, entry]; })); payload.entries.forEach(function (incoming) { if (!incoming.id || !incoming.updatedAt) return; const current = byId.get(incoming.id); if (!current || new Date(incoming.updatedAt) > new Date(current.updatedAt || 0)) { byId.set(incoming.id, normalizeEntry(incoming)); changed += 1; } }); state.entries = Array.from(byId.values()); await replaceAllEntries(state.entries); renderAll(); return { changed: changed }; }
function normalizeEntry(entry) { return { id: String(entry.id), createdAt: entry.createdAt || new Date().toISOString(), updatedAt: entry.updatedAt || new Date().toISOString(), deletedAt: entry.deletedAt || "", title: entry.title || "Untitled", body: entry.body || "", mood: moods[entry.mood] ? entry.mood : "steady", intensity: Math.min(10, Math.max(1, Number(entry.intensity) || 5)), tags: Array.isArray(entry.tags) ? entry.tags.map(cleanText).filter(Boolean) : [], people: Array.isArray(entry.people) ? entry.people.map(cleanText).filter(Boolean) : [], location: { label: entry.location && entry.location.label ? entry.location.label : "Unplaced", lat: entry.location ? entry.location.lat : null, lng: entry.location ? entry.location.lng : null, accuracy: entry.location ? entry.location.accuracy : null, source: entry.location && entry.location.source ? entry.location.source : "manual" }, timeZone: entry.timeZone || "", utcOffsetMinutes: Number.isFinite(entry.utcOffsetMinutes) ? entry.utcOffsetMinutes : new Date(entry.createdAt || Date.now()).getTimezoneOffset() }; }
async function requestPersistentStorage() { if (!navigator.storage || !navigator.storage.persist) { setBackupStatus("Persistent storage is unavailable here."); return; } const persisted = await navigator.storage.persist(); setBackupStatus(persisted ? "Browser storage protected." : "Browser storage unchanged."); }

function openDatabase() { return new Promise(function (resolve, reject) { if (!window.indexedDB) { reject(new Error("IndexedDB is not available.")); return; } const request = indexedDB.open(DB_NAME, DB_VERSION); request.onupgradeneeded = function () { const db = request.result; if (!db.objectStoreNames.contains(ENTRY_STORE)) { const entries = db.createObjectStore(ENTRY_STORE, { keyPath: "id" }); entries.createIndex("createdAt", "createdAt"); entries.createIndex("updatedAt", "updatedAt"); } if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE, { keyPath: "id" }); }; request.onsuccess = function () { resolve(request.result); }; request.onerror = function () { reject(request.error); }; }); }
function transaction(storeName, mode, callback) { return new Promise(function (resolve, reject) { const tx = state.db.transaction(storeName, mode); const store = tx.objectStore(storeName); callback(store); tx.oncomplete = function () { resolve(); }; tx.onerror = function () { reject(tx.error); }; tx.onabort = function () { reject(tx.error); }; }); }
function readAllEntries() { return new Promise(function (resolve, reject) { const tx = state.db.transaction(ENTRY_STORE, "readonly"); const request = tx.objectStore(ENTRY_STORE).getAll(); request.onsuccess = function () { resolve((request.result || []).map(normalizeEntry)); }; request.onerror = function () { reject(request.error); }; }); }
async function writeEntry(entry) { await transaction(ENTRY_STORE, "readwrite", function (store) { store.put(entry); }); }
async function replaceAllEntries(entries) { await transaction(ENTRY_STORE, "readwrite", function (store) { store.clear(); entries.forEach(function (entry) { store.put(entry); }); }); }
function readSettings() { return new Promise(function (resolve, reject) { const tx = state.db.transaction(SETTINGS_STORE, "readonly"); const request = tx.objectStore(SETTINGS_STORE).get(SETTINGS_KEY); request.onsuccess = function () { resolve(request.result && request.result.value ? request.result.value : {}); }; request.onerror = function () { reject(request.error); }; }); }
async function writeSettings(settings) { if (!state.db) return; await transaction(SETTINGS_STORE, "readwrite", function (store) { store.put({ id: SETTINGS_KEY, value: settings }); }); }
async function registerServiceWorker() { if (!("serviceWorker" in navigator) || location.protocol === "file:") return; try { await navigator.serviceWorker.register("./service-worker.js"); } catch (error) { console.warn("Service worker did not register.", error); } }

function setCurrentDateTime() { els.entryDateTime.value = toLocalInput(new Date()); }
function toLocalInput(value) { const date = new Date(value); const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16); }
function fromLocalInput(value) { return value ? new Date(value) : new Date(); }
function defaultTitle(iso) { return "Log " + formatDateTime(iso); }
function parseList(value) { return Array.from(new Set(value.split(",").map(cleanText).filter(Boolean))).slice(0, 20); }
function cleanText(value) { return String(value || "").trim().replace(/\s+/g, " "); }
function createId() { return crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2); }
function roundCoord(value) { return Math.round(value * 100000) / 100000; }
function moodScore(entry) { const base = moods[entry.mood] ? moods[entry.mood].score : 5; const intensity = Number(entry.intensity) || 5; return Math.min(10, Math.max(1, base * 0.65 + intensity * 0.35)); }
function moodColor(mood) { return moods[mood] ? moods[mood].color : moods.steady.color; }
function moodLabel(mood) { return moods[mood] ? moods[mood].label : "Steady"; }
function getEntryColor(entry, index) { return moodColor(entry.mood) || bookPalette[index % bookPalette.length]; }
function average(values) { return values.length ? values.reduce(function (sum, value) { return sum + value; }, 0) / values.length : 0; }
function aggregate(items, keyer) { const map = new Map(); items.forEach(function (item) { const key = cleanText(keyer(item)) || "Unplaced"; if (!map.has(key)) map.set(key, []); map.get(key).push(item); }); return Array.from(map.entries()).map(function (entry) { return { key: entry[0], entries: entry[1] }; }); }
function topItem(items) { const rows = aggregate(items, function (item) { return item; }); rows.sort(function (a, b) { return b.entries.length - a.entries.length; }); return rows[0] ? rows[0].key : ""; }
function isWithinDays(iso, days) { return Date.now() - new Date(iso).getTime() <= days * 24 * 60 * 60 * 1000; }
function formatDateTime(iso) { return new Date(iso).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
function shortDate(iso) { return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }); }
function setStatus(message) { els.storageStatus.textContent = message; }
function setFormStatus(message) { els.formStatus.textContent = message; }
function setBackupStatus(message) { els.backupStatus.textContent = message; }
function emptyNode() { return els.emptyTemplate.content.firstElementChild.cloneNode(true); }
function miniEmpty(message) { return "<div class=\"empty-state\" style=\"min-height:180px\"><h3>" + escapeHtml(message) + "</h3></div>"; }
function escapeHtml(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
function softColor(color) { return "color-mix(in srgb, " + color + " 18%, #fffaf0)"; }
function downloadJson(payload, filename) { const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url); }
function readableError(error) { const message = error && error.message ? error.message : String(error); if (message.includes("invalid_client")) return "Google rejected the client ID."; if (message.includes("popup")) return "Google sign-in was blocked."; if (message.length > 160) return "The Drive request failed."; return message; }
