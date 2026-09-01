import {
  parseSequence,
  cumulativeStarts,
  resolveElapsed,
  locateElapsed,
  formatClock,
  formatDurationLabel,
} from "./timer-core.js";

const STORAGE_KEY = "wayline-state-v1";
const SAVED_KEY = "wayline-saved-v1";
const SETTINGS_KEY = "wayline-settings-v1";

const $ = (selector) => document.querySelector(selector);
const ui = {
  form: $("#sequenceForm"), input: $("#sequenceInput"), alternate: $("#alternateToggle"),
  parseMessage: $("#parseMessage"), saved: $("#savedSequences"), bar: $("#sessionBar"),
  current: $("#currentLabel"), remaining: $("#remainingTime"), finish: $("#finishTime"),
  elapsed: $("#elapsedLabel"), total: $("#totalLabel"), breakLegend: $("#breakLegend"),
  play: $("#playButton"), playLabel: $("#playLabel"), playIcon: $("#playIcon"), reset: $("#resetButton"),
  sound: $("#soundToggle"), wake: $("#wakeToggle"), notifications: $("#notificationButton"),
  notificationStatus: $("#notificationStatus"), install: $("#installButton"), dialog: $("#infoDialog"),
  offlineStatus: $("#offlineStatus"),
};

let state = loadState();
let saved = loadJson(SAVED_KEY, []);
let settings = loadJson(SETTINGS_KEY, { sound: true, wake: false });
let lastBlockIndex = -1;
let audioContext = null;
let wakeLock = null;
let installPrompt = null;
let tickHandle = null;

function defaultState() {
  const parsed = parseSequence("25 + 5 + 25 + 15");
  return {
    sequenceText: parsed.canonical,
    durationsSec: parsed.durationsSec,
    alternate: false,
    status: "idle",
    elapsedMs: 0,
    startEpochMs: null,
  };
}

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function loadState() {
  const fallback = defaultState();
  const candidate = loadJson(STORAGE_KEY, fallback);
  if (!candidate || !Array.isArray(candidate.durationsSec) || !candidate.durationsSec.length) return fallback;
  if (!["idle", "running", "paused", "complete"].includes(candidate.status)) return fallback;
  return { ...fallback, ...candidate };
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function currentElapsedMs() {
  return resolveElapsed(state);
}

function setRoute(text, alternate = ui.alternate.checked) {
  const parsed = parseSequence(text);
  state = {
    sequenceText: String(text).trim(),
    durationsSec: parsed.durationsSec,
    alternate,
    status: "idle",
    elapsedMs: 0,
    startEpochMs: null,
  };
  ui.input.value = state.sequenceText;
  ui.alternate.checked = alternate;
  lastBlockIndex = 0;
  persistState();
  renderBar();
  render();
  ui.parseMessage.textContent = `${parsed.durationsSec.length} blocks · ${formatClock(parsed.totalSec * 1000)}`;
  ui.parseMessage.classList.add("ok");
  cancelScheduledNotifications();
  return parsed;
}

function saveRoute() {
  const item = { text: state.sequenceText, alternate: state.alternate, savedAt: Date.now() };
  saved = [item, ...saved.filter((entry) => !(entry.text === item.text && entry.alternate === item.alternate))].slice(0, 8);
  localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
  renderSaved();
}

function renderSaved() {
  ui.saved.replaceChildren();
  if (!saved.length) {
    const empty = document.createElement("span");
    empty.className = "saved-empty";
    empty.textContent = "Routes you start appear here.";
    ui.saved.append(empty);
    return;
  }
  saved.forEach((item, index) => {
    const chip = document.createElement("span");
    chip.className = "saved-chip";
    const load = document.createElement("button");
    load.type = "button";
    load.className = "saved-load";
    load.textContent = item.text + (item.alternate ? " · alt" : "");
    load.setAttribute("aria-label", `Load ${item.text}`);
    load.addEventListener("click", () => setRoute(item.text, item.alternate));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "saved-delete";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove saved route ${item.text}`);
    remove.addEventListener("click", () => {
      saved.splice(index, 1);
      localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
      renderSaved();
    });
    chip.append(load, remove);
    ui.saved.append(chip);
  });
}

function renderBar() {
  ui.bar.replaceChildren();
  const total = state.durationsSec.reduce((sum, value) => sum + value, 0);
  state.durationsSec.forEach((seconds, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `segment ${state.alternate && index % 2 ? "break" : "focus"}`;
    button.style.flexGrow = String(seconds);
    if (seconds / total < .065) button.classList.add("narrow");
    button.setAttribute("aria-label", `Jump to block ${index + 1}, ${formatDurationLabel(seconds)}, ${state.alternate && index % 2 ? "break" : "focus"}`);
    button.innerHTML = `<span class="segment-fill"></span><span class="segment-copy"><span class="segment-index">${String(index + 1).padStart(2, "0")}</span><span class="segment-duration">${formatDurationLabel(seconds)}</span></span>`;
    button.addEventListener("click", () => jumpToBlock(index));
    ui.bar.append(button);
  });
  ui.breakLegend.hidden = !state.alternate;
}

function render() {
  const elapsedMs = currentElapsedMs();
  const located = locateElapsed(state.durationsSec, elapsedMs);
  if (state.status === "running" && located.complete) finishSession();
  const effectiveStatus = located.complete ? "complete" : state.status;
  const type = state.alternate && located.index % 2 ? "Break" : "Focus";
  ui.current.textContent = effectiveStatus === "complete" ? "Route complete" : `Block ${located.index + 1} · ${type}`;
  ui.remaining.textContent = effectiveStatus === "complete" ? "0:00" : formatClock(located.blockRemainingMs);
  ui.elapsed.textContent = `${formatClock(located.elapsedMs)} elapsed`;
  ui.total.textContent = `${formatClock(located.totalMs)} total`;

  if (state.status === "running") {
    ui.finish.textContent = formatFinish(state.startEpochMs + located.totalMs);
    ui.playLabel.textContent = "Pause";
    ui.playIcon.textContent = "Ⅱ";
  } else if (state.status === "paused") {
    ui.finish.textContent = "Paused";
    ui.playLabel.textContent = "Resume";
    ui.playIcon.textContent = "▶";
  } else {
    ui.finish.textContent = formatFinish(Date.now() + Math.max(0, located.totalMs - located.elapsedMs));
    ui.playLabel.textContent = effectiveStatus === "complete" ? "Start again" : "Start route";
    ui.playIcon.textContent = "▶";
  }

  [...ui.bar.children].forEach((segment, index) => {
    const fill = segment.querySelector(".segment-fill");
    let percentage = 0;
    if (index < located.index || located.complete) percentage = 100;
    else if (index === located.index) percentage = (located.inBlockMs / (state.durationsSec[index] * 1000)) * 100;
    fill.style.width = `${Math.max(0, Math.min(100, percentage))}%`;
    segment.classList.toggle("active", index === located.index && !located.complete);
    segment.setAttribute("aria-current", index === located.index && !located.complete ? "true" : "false");
  });

  if (state.status === "running" && !located.complete && lastBlockIndex !== -1 && located.index !== lastBlockIndex) {
    signalHandoff(located.index, type);
  }
  lastBlockIndex = located.index;
}

function formatFinish(epochMs) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(epochMs));
}

function togglePlay() {
  unlockAudio();
  if (state.status === "running") {
    state.elapsedMs = currentElapsedMs();
    state.startEpochMs = null;
    state.status = "paused";
    releaseWakeLock();
    cancelScheduledNotifications();
  } else {
    const located = locateElapsed(state.durationsSec, state.elapsedMs);
    if (located.complete || state.status === "complete") state.elapsedMs = 0;
    state.startEpochMs = Date.now() - state.elapsedMs;
    state.status = "running";
    lastBlockIndex = locateElapsed(state.durationsSec, state.elapsedMs).index;
    saveRoute();
    requestWakeLock();
    scheduleNotifications();
  }
  persistState();
  render();
}

function reset() {
  state.status = "idle";
  state.elapsedMs = 0;
  state.startEpochMs = null;
  lastBlockIndex = 0;
  persistState();
  releaseWakeLock();
  cancelScheduledNotifications();
  render();
}

function jumpToBlock(index) {
  unlockAudio();
  const startMs = cumulativeStarts(state.durationsSec)[index] * 1000;
  state.elapsedMs = startMs;
  if (state.status === "running") state.startEpochMs = Date.now() - startMs;
  else state.status = "paused";
  lastBlockIndex = index;
  persistState();
  if (state.status === "running") scheduleNotifications();
  render();
}

function finishSession() {
  if (state.status !== "running") return;
  const totalMs = state.durationsSec.reduce((sum, value) => sum + value * 1000, 0);
  state.status = "complete";
  state.elapsedMs = totalMs;
  state.startEpochMs = null;
  persistState();
  playChime(true);
  showNotification("Route complete", "Your Wayline session has finished.", "wayline-finish");
  releaseWakeLock();
  cancelScheduledNotifications();
}

function signalHandoff(index, type) {
  playChime(false);
  showNotification(`Block ${index + 1} · ${type}`, `${formatDurationLabel(state.durationsSec[index])} starts now.`, `wayline-live-${index}`);
}

function unlockAudio() {
  if (!settings.sound) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  audioContext ||= new AudioCtx();
  if (audioContext.state === "suspended") audioContext.resume();
}

function playChime(final = false) {
  if (!settings.sound) return;
  unlockAudio();
  if (!audioContext) return;
  const now = audioContext.currentTime;
  const notes = final ? [523.25, 659.25, 783.99] : [659.25, 880];
  notes.forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const start = now + index * .13;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(.16, start + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, start + .36);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + .38);
  });
}

async function requestWakeLock() {
  if (!settings.wake || state.status !== "running" || document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch { wakeLock = null; }
}

async function releaseWakeLock() {
  try { await wakeLock?.release(); } catch { /* already released */ }
  wakeLock = null;
}

async function enableNotifications() {
  if (!("Notification" in window)) {
    ui.notificationStatus.textContent = "Not supported by this browser";
    return;
  }
  const permission = await Notification.requestPermission();
  updateNotificationStatus(permission);
  if (permission === "granted") {
    showNotification("Wayline is ready", "Handoff notifications are enabled while the timer can run.", "wayline-ready");
    scheduleNotifications();
  }
}

function updateNotificationStatus(permission = window.Notification?.permission) {
  if (!("Notification" in window)) ui.notificationStatus.textContent = "Not supported by this browser";
  else if (permission === "granted") ui.notificationStatus.textContent = "Enabled · exact closed-app alarms are browser-limited";
  else if (permission === "denied") ui.notificationStatus.textContent = "Blocked in browser settings";
  else ui.notificationStatus.textContent = "For handoffs while Android keeps the app active";
}

async function showNotification(title, body, tag) {
  if (!("serviceWorker" in navigator) || window.Notification?.permission !== "granted") return;
  try {
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage({ type: "SHOW_NOTIFICATION", title, body, tag });
  } catch { /* notifications are optional */ }
}

async function cancelScheduledNotifications() {
  if (!("serviceWorker" in navigator) || window.Notification?.permission !== "granted") return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const notifications = await registration.getNotifications();
    notifications.filter((item) => item.tag.startsWith("wayline-scheduled-")).forEach((item) => item.close());
  } catch { /* unsupported scheduled-notification implementation */ }
}

async function scheduleNotifications() {
  await cancelScheduledNotifications();
  // Notification Triggers was an experimental Android API and is absent in normal Chrome.
  // Feature detection keeps the app ready for browsers that independently implement it.
  if (state.status !== "running" || !("TimestampTrigger" in window) || window.Notification?.permission !== "granted") return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const starts = cumulativeStarts(state.durationsSec);
    for (let index = 1; index < state.durationsSec.length; index += 1) {
      const when = state.startEpochMs + starts[index] * 1000;
      if (when > Date.now()) {
        const type = state.alternate && index % 2 ? "Break" : "Focus";
        await registration.showNotification(`Block ${index + 1} · ${type}`, {
          body: `${formatDurationLabel(state.durationsSec[index])} starts now.`,
          tag: `wayline-scheduled-${index}`,
          icon: "icons/icon-192.png",
          badge: "icons/icon-192.png",
          showTrigger: new window.TimestampTrigger(when),
          data: { url: "./" },
        });
      }
    }
    const finish = state.startEpochMs + state.durationsSec.reduce((sum, value) => sum + value * 1000, 0);
    if (finish > Date.now()) {
      await registration.showNotification("Route complete", {
        body: "Your Wayline session has finished.",
        tag: "wayline-scheduled-finish",
        icon: "icons/icon-192.png",
        badge: "icons/icon-192.png",
        showTrigger: new window.TimestampTrigger(finish),
        data: { url: "./" },
      });
    }
  } catch { /* experimental API may exist but reject */ }
}

function startTicker() {
  clearInterval(tickHandle);
  tickHandle = setInterval(render, 250);
}

ui.form.addEventListener("submit", (event) => {
  event.preventDefault();
  ui.parseMessage.classList.remove("ok");
  try { setRoute(ui.input.value, ui.alternate.checked); }
  catch (error) { ui.parseMessage.textContent = error.message; }
});

ui.input.addEventListener("input", () => {
  ui.parseMessage.classList.remove("ok");
  try {
    const parsed = parseSequence(ui.input.value);
    ui.parseMessage.textContent = `${parsed.durationsSec.length} blocks · ${formatClock(parsed.totalSec * 1000)}`;
    ui.parseMessage.classList.add("ok");
  } catch (error) { ui.parseMessage.textContent = error.message; }
});

ui.alternate.addEventListener("change", () => {
  state.alternate = ui.alternate.checked;
  persistState();
  renderBar();
  render();
  if (state.status === "running") scheduleNotifications();
});
ui.play.addEventListener("click", togglePlay);
ui.reset.addEventListener("click", reset);
ui.sound.addEventListener("change", () => {
  settings.sound = ui.sound.checked;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  if (settings.sound) { unlockAudio(); playChime(false); }
});
ui.wake.addEventListener("change", () => {
  settings.wake = ui.wake.checked;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  if (settings.wake) requestWakeLock(); else releaseWakeLock();
});
ui.notifications.addEventListener("click", enableNotifications);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  ui.install.hidden = false;
});
ui.install.addEventListener("click", async () => {
  if (installPrompt) {
    await installPrompt.prompt();
    installPrompt = null;
    ui.install.hidden = true;
  } else ui.dialog.showModal();
});
window.addEventListener("appinstalled", () => { ui.install.hidden = true; });

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    render();
    requestWakeLock();
  }
});
window.addEventListener("pagehide", persistState);
window.addEventListener("online", () => { ui.offlineStatus.textContent = "Online · offline copy ready"; });
window.addEventListener("offline", () => { ui.offlineStatus.textContent = "Offline · local copy active"; });

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    await navigator.serviceWorker.ready;
    ui.offlineStatus.textContent = navigator.onLine ? "Online · offline copy ready" : "Offline · local copy active";
  } catch { ui.offlineStatus.textContent = "Offline setup unavailable"; }
}

ui.input.value = state.sequenceText;
ui.alternate.checked = state.alternate;
ui.sound.checked = settings.sound;
ui.wake.checked = settings.wake;
renderSaved();
renderBar();
render();
updateNotificationStatus();
startTicker();
registerServiceWorker();
if (state.status === "running") {
  lastBlockIndex = locateElapsed(state.durationsSec, currentElapsedMs()).index;
  requestWakeLock();
  scheduleNotifications();
}

// Exposed only for automated smoke tests; harmless in production.
window.__wayline = { getState: () => ({ ...state, elapsedMs: currentElapsedMs() }), setRoute, jumpToBlock };
