const DEFAULT_SECONDS = 30 * 60;

const timerEl       = document.getElementById("timer");
const hintEl        = document.getElementById("nextHint");
const drinkBtn      = document.getElementById("drinkBtn");
const resetBtn      = document.getElementById("resetBtn");
const intervalSelect= document.getElementById("intervalSelect");
const customRow     = document.getElementById("customRow");
const customIntervalValue = document.getElementById("customIntervalValue");
const customIntervalUnit  = document.getElementById("customIntervalUnit");
const customApplyBtn      = document.getElementById("customApplyBtn");
const timerToggle   = document.getElementById("timerToggle");
const notifToggle   = document.getElementById("notifToggle");
const timerStatus   = document.getElementById("timerStatus");
const notifStatus   = document.getElementById("notifStatus");
const toast         = document.getElementById("toast");
const progressBar   = document.getElementById("progressBar");

let intervalSeconds = DEFAULT_SECONDS;
let customSeconds = DEFAULT_SECONDS;
let tickHandle = null;
let isRunning = false;
let lastFiredAt = null;

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

const PRESET_MINUTES = [15, 30, 45, 60];

const LS_KEYS = {
  // 新版用秒存储；同时兼容旧版 minutes 字段
  intervalSeconds: "intervalSeconds",
  customSeconds: "customSeconds",
  intervalMinutes: "intervalMinutes",
  customMinutes: "customMinutes",
  alarmStartTime: "alarmStartTime",
  timerRunning: "timerRunning",
  notifEnabled: "notifEnabled",
  lastFiredAt: "lastFiredAt"
};

function lsGetRaw(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function lsSetRaw(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

function lsGetNumber(key, fallback) {
  const raw = lsGetRaw(key);
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function lsGetBool(key, fallback) {
  const raw = lsGetRaw(key);
  if (raw == null) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

function lsSetMany(values) {
  Object.entries(values).forEach(([k, v]) => {
    if (v === undefined) return;
    if (v === null) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
      return;
    }
    lsSetRaw(k, String(v));
  });
}

function formatMMSS(sec) {
  const s = Math.max(0, Math.floor(sec));
  return String(Math.floor(s / 60)).padStart(2,"0") + ":" + String(s % 60).padStart(2,"0");
}

let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2000);
}

function calcRemaining(alarmStartTime, intervalSec) {
  const total = Math.max(1, Math.floor(intervalSec));
  // 用整数秒避免“整点跳回满值”，确保会出现 0 从而触发通知
  const elapsedSec = Math.max(0, Math.floor((Date.now() - alarmStartTime) / 1000));
  return (total - (elapsedSec % total)) % total;
}

function render(remainingSec) {
  timerEl.textContent = formatMMSS(remainingSec);
  const ratio = intervalSeconds > 0 ? remainingSec / intervalSeconds : 0;
  progressBar.style.width = clamp(ratio * 100, 0, 100) + "%";
}

function intervalText(sec) {
  const s = Math.max(1, Math.floor(sec));
  if (s % 3600 === 0) return `每 ${s / 3600} 小时提醒一次`;
  if (s % 60 === 0) return `每 ${s / 60} 分钟提醒一次`;
  return `每 ${s} 秒提醒一次`;
}

// ── 通知函数（已适配 Electron）──────────────────────────
async function safeNotify() {
  if (!notifToggle.checked) return;

  // Electron 环境：通过 preload 桥梁发系统通知
  if (window.electronAPI) {
    try {
      const ok = await window.electronAPI.sendNotification("喝水提醒 💧", "该喝水啦，记得保持水分！");
      if (!ok) showToast("该喝水啦～（通知可能被系统拦截）");
    } catch {
      showToast("该喝水啦～（通知发送失败）");
    }
    return;
  }

  // 降级方案：普通浏览器通知
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification("喝水提醒", { body: "该喝水啦～" });
      return;
    } catch { /* ignore */ }
  }

  showToast("该喝水啦～");
}

// 更新界面的"运行/暂停"状态
function applyRunningUI(running) {
  isRunning = running;
  timerToggle.checked = running;
  timerStatus.textContent = running ? "运行中" : "未开启";
  drinkBtn.disabled = !running;
  resetBtn.disabled = !running;

  if (running) {
    timerEl.classList.remove("paused");
    progressBar.classList.remove("paused");
  } else {
    timerEl.classList.add("paused");
    progressBar.classList.add("paused");
    timerEl.textContent = "--:--";
    progressBar.style.width = "100%";
    hintEl.textContent = "提醒未开启";
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
  }
}

function startDisplayTicker(alarmStartTime) {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = setInterval(() => {
    const remaining = calcRemaining(alarmStartTime, intervalSeconds);
    render(remaining);

    if (remaining <= 0) {
      const now = Date.now();
      const cooldownMs = 1500;
      if (!lastFiredAt || (now - lastFiredAt) > cooldownMs) {
        lastFiredAt = now;
        void safeNotify();
        const nextStart = now;
        lsSetMany({ [LS_KEYS.alarmStartTime]: nextStart, [LS_KEYS.lastFiredAt]: lastFiredAt });
        alarmStartTime = nextStart;
        hintEl.textContent = intervalText(intervalSeconds);
      }
    }
  }, 1000);
}

function applyNotifUI(enabled) {
  notifToggle.checked = enabled;
  notifStatus.textContent = enabled ? "已开启" : "未开启";
}

function showCustomRow(show) {
  if (!customRow) return;
  customRow.classList.toggle("show", !!show);
}

function minutesFromCustomInput() {
  const v = Number(customIntervalValue.value);
  const unit = customIntervalUnit.value;
  if (!Number.isFinite(v)) return null;
  if (v <= 0) return null;

  const seconds =
    unit === "hours" ? v * 3600 :
    unit === "minutes" ? v * 60 :
    v;

  const rounded = Math.round(seconds);
  if (!Number.isFinite(rounded) || rounded <= 0) return null;
  return clamp(rounded, 1, 24 * 60 * 60);
}

function syncCustomInputsFromSeconds(sec) {
  const s = clamp(Number(sec) || DEFAULT_SECONDS, 1, 24 * 60 * 60);
  // 默认优先展示“分钟”，除非不是整分钟
  if (s % 60 === 0) {
    customIntervalUnit.value = "minutes";
    customIntervalValue.value = String(s / 60);
  } else {
    customIntervalUnit.value = "seconds";
    customIntervalValue.value = String(s);
  }
}

async function requestNotifPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  const p = await Notification.requestPermission();
  return p === "granted";
}

function init() {
  // 优先读取新版秒字段；若没有则兼容旧版分钟字段
  const savedSeconds = lsGetNumber(LS_KEYS.intervalSeconds, null);
  const savedMinutes = lsGetNumber(LS_KEYS.intervalMinutes, null);
  intervalSeconds = Number.isFinite(savedSeconds) && savedSeconds > 0
    ? savedSeconds
    : (Number.isFinite(savedMinutes) && savedMinutes > 0 ? savedMinutes * 60 : DEFAULT_SECONDS);

  const savedCustomSeconds = lsGetNumber(LS_KEYS.customSeconds, null);
  const savedCustomMinutes = lsGetNumber(LS_KEYS.customMinutes, null);
  customSeconds = Number.isFinite(savedCustomSeconds) && savedCustomSeconds > 0
    ? savedCustomSeconds
    : (Number.isFinite(savedCustomMinutes) && savedCustomMinutes > 0 ? savedCustomMinutes * 60 : intervalSeconds);

  const running = lsGetBool(LS_KEYS.timerRunning, false);
  const notifOn = lsGetBool(LS_KEYS.notifEnabled, false);
  const startTime = lsGetNumber(LS_KEYS.alarmStartTime, 0);
  lastFiredAt = lsGetNumber(LS_KEYS.lastFiredAt, null);

  const isPreset = (intervalSeconds % 60 === 0) && PRESET_MINUTES.includes(Number(intervalSeconds / 60));
  if (isPreset) {
    const opt = intervalSelect.querySelector(`option[value="${intervalSeconds / 60}"]`);
    if (opt) opt.selected = true;
    showCustomRow(false);
  } else {
    intervalSelect.value = "custom";
    showCustomRow(true);
    syncCustomInputsFromSeconds(intervalSeconds);
  }

  applyNotifUI(notifOn);
  applyRunningUI(running);

  if (running) {
    const ensuredStart = startTime > 0 ? startTime : Date.now();
    lsSetMany({ [LS_KEYS.alarmStartTime]: ensuredStart, [LS_KEYS.timerRunning]: true });
    const remaining = calcRemaining(ensuredStart, intervalSeconds);
    hintEl.textContent = intervalText(intervalSeconds);
    render(remaining);
    startDisplayTicker(ensuredStart);
  }
}

// ── 事件：提醒开关 ──────────────────────────
timerToggle.addEventListener("change", () => {
  if (timerToggle.checked) {
    const startTime = Date.now();
    lsSetMany({ [LS_KEYS.timerRunning]: true, [LS_KEYS.alarmStartTime]: startTime });
    applyRunningUI(true);
    hintEl.textContent = intervalText(intervalSeconds);
    render(intervalSeconds);
    startDisplayTicker(startTime);
    showToast("提醒已开启 ✓");
  } else {
    lsSetMany({ [LS_KEYS.timerRunning]: false });
    applyRunningUI(false);
    showToast("提醒已关闭");
  }
});

// ── 事件：通知开关（已适配 Electron）──────────────────────────
notifToggle.addEventListener("change", async () => {
  if (notifToggle.checked) {
    // Electron 环境直接开启，无需请求权限
    if (window.electronAPI) {
      lsSetMany({ [LS_KEYS.notifEnabled]: true });
      applyNotifUI(true);
      showToast("通知已开启 ✓");
      return;
    }
    // 普通浏览器需要请求权限
    const granted = await requestNotifPermission();
    if (granted) {
      lsSetMany({ [LS_KEYS.notifEnabled]: true });
      applyNotifUI(true);
      showToast("通知已开启 ✓");
    } else {
      applyNotifUI(false);
      lsSetMany({ [LS_KEYS.notifEnabled]: false });
      showToast("通知权限被拒绝");
    }
  } else {
    lsSetMany({ [LS_KEYS.notifEnabled]: false });
    applyNotifUI(false);
    showToast("通知已关闭");
  }
});

// ── 事件：我喝了 ──────────────────────────
drinkBtn.addEventListener("click", () => {
  const startTime = Date.now();
  lsSetMany({ [LS_KEYS.alarmStartTime]: startTime });
  hintEl.textContent = intervalText(intervalSeconds);
  render(intervalSeconds);
  startDisplayTicker(startTime);
  showToast("喝水记录 ✓ 倒计时已重置");
});

// ── 事件：重置倒计时 ──────────────────────────
resetBtn.addEventListener("click", () => {
  const startTime = Date.now();
  lsSetMany({ [LS_KEYS.alarmStartTime]: startTime });
  render(intervalSeconds);
  startDisplayTicker(startTime);
  showToast("倒计时已重置");
});

// ── 事件：修改间隔 ──────────────────────────
intervalSelect.addEventListener("change", (e) => {
  const v = String(e.target.value);
  if (v === "custom") {
    showCustomRow(true);
    syncCustomInputsFromSeconds(customSeconds || intervalSeconds);
    return;
  }

  showCustomRow(false);
  intervalSeconds = Number(v) * 60;
  lsSetMany({
    [LS_KEYS.intervalSeconds]: intervalSeconds,
    // 写入兼容字段，方便旧逻辑/旧版本读取
    [LS_KEYS.intervalMinutes]: Math.round(intervalSeconds / 60),
  });
  if (isRunning) {
    const startTime = Date.now();
    lsSetMany({ [LS_KEYS.alarmStartTime]: startTime });
    hintEl.textContent = intervalText(intervalSeconds);
    render(intervalSeconds);
    startDisplayTicker(startTime);
    showToast("间隔已更新");
  }
});

// ── 事件：应用自定义间隔 ──────────────────────────
customApplyBtn.addEventListener("click", () => {
  const s = minutesFromCustomInput();
  if (!s) {
    showToast("请输入有效的时间（1-86400 秒）");
    return;
  }
  customSeconds = s;
  intervalSeconds = s;
  lsSetMany({
    [LS_KEYS.customSeconds]: customSeconds,
    [LS_KEYS.intervalSeconds]: intervalSeconds,
    // 兼容字段
    [LS_KEYS.customMinutes]: Math.round(customSeconds / 60),
    [LS_KEYS.intervalMinutes]: Math.round(intervalSeconds / 60),
  });

  if (isRunning) {
    const startTime = Date.now();
    lsSetMany({ [LS_KEYS.alarmStartTime]: startTime });
    hintEl.textContent = intervalText(intervalSeconds);
    render(intervalSeconds);
    startDisplayTicker(startTime);
  } else {
    hintEl.textContent = intervalText(intervalSeconds);
    render(intervalSeconds);
  }
  showToast("自定义间隔已应用");
});

window.addEventListener("unload", () => {
  if (tickHandle) clearInterval(tickHandle);
});

init();