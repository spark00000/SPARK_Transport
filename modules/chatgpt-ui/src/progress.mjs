export const PROGRESS_ROOT_ID = "spark-progress-overlay";
export const PROGRESS_STYLE_ID = "spark-progress-overlay-style";

function safeSnapshot(snapshot = {}) {
  const activity = snapshot?.activity && typeof snapshot.activity === "object"
    ? snapshot.activity
    : {};
  return {
    checkedAt: typeof snapshot?.checkedAt === "string" ? snapshot.checkedAt : null,
    transportError: typeof snapshot?.transportError === "string" ? snapshot.transportError : null,
    activity: {
      active: activity.active ?? null,
      pendingUncertainMutation: activity.pendingUncertainMutation ?? null,
      last: activity.last ?? null,
    },
  };
}

function progressCss(theme) {
  const c = theme.colors;
  return [
    `#${PROGRESS_ROOT_ID} { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; font: 600 9px/1.18 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: ${c.text.primary}; }`,
    `#${PROGRESS_ROOT_ID} .spark-progress-panel { position: fixed; box-sizing: border-box; overflow: hidden; border: 1px solid ${c.borders.strong}; border-radius: 5px; background: ${c.surfaces.elevatedBackground}; box-shadow: 0 2px 8px rgba(0,0,0,.18); opacity: .92; }`,
    `#${PROGRESS_ROOT_ID} .spark-progress-top { padding: 4px 5px; }`,
    `#${PROGRESS_ROOT_ID} .spark-progress-bottom { padding: 4px 5px; }`,
    `#${PROGRESS_ROOT_ID} .spark-progress-row { display: grid; grid-template-columns: 34px 1fr auto; gap: 4px; align-items: center; min-height: 15px; }`,
    `#${PROGRESS_ROOT_ID} .spark-progress-label { color: ${c.text.secondary}; letter-spacing: .02em; }`,
    `#${PROGRESS_ROOT_ID} .spark-progress-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`,
    `#${PROGRESS_ROOT_ID} .spark-progress-time { color: ${c.text.secondary}; min-width: 24px; text-align: right; }`,
    `#${PROGRESS_ROOT_ID} .spark-progress-track { grid-column: 2 / 4; height: 2px; margin: -1px 0 2px; border-radius: 2px; overflow: hidden; background: ${c.surfaces.elevatedSecondaryBackground}; }`,
    `#${PROGRESS_ROOT_ID} .spark-progress-fill { height: 100%; width: 0%; border-radius: inherit; transition: width .2s linear; background: ${c.charts.blue}; }`,
    `#${PROGRESS_ROOT_ID} .spark-progress-fill.working { width: 34%; animation: spark-progress-slide 1.5s ease-in-out infinite alternate; }`,
    `#${PROGRESS_ROOT_ID} .spark-progress-fill.success { background: ${c.charts.green}; }`,
    `#${PROGRESS_ROOT_ID} .spark-progress-fill.warning { background: ${c.charts.orange}; }`,
    `#${PROGRESS_ROOT_ID} .spark-progress-fill.danger { background: ${c.charts.red}; }`,
    `#${PROGRESS_ROOT_ID} .spark-usage-row { display: grid; grid-template-columns: 18px 28px 1fr; gap: 2px; align-items: center; min-height: 15px; white-space: nowrap; }`,
    `#${PROGRESS_ROOT_ID} .spark-usage-label { color: ${c.text.secondary}; }`,
    `#${PROGRESS_ROOT_ID} .spark-usage-percent { text-align: right; }`,
    `#${PROGRESS_ROOT_ID} .spark-usage-reset { color: ${c.text.secondary}; overflow: hidden; text-overflow: ellipsis; text-align: right; }`,
    `#${PROGRESS_ROOT_ID} .spark-telemetry-row { display: flex; justify-content: space-between; gap: 4px; min-height: 15px; white-space: nowrap; }`,
    `#${PROGRESS_ROOT_ID} .spark-telemetry-row span:first-child { color: ${c.text.secondary}; }`,
    `#${PROGRESS_ROOT_ID} .spark-telemetry-row span:last-child { overflow: hidden; text-overflow: ellipsis; text-align: right; }`,
    '@keyframes spark-progress-slide { from { transform: translateX(-35%); } to { transform: translateX(190%); } }',
  ].join('\n');
}

function progressHtml() {
  return [
    '<div class="spark-progress-panel spark-progress-top" data-k="top-panel">',
    '<div class="spark-progress-row"><span class="spark-progress-label">BRAIN</span><span class="spark-progress-value" data-k="brain"></span><span class="spark-progress-time" data-k="brain-time"></span><div class="spark-progress-track"><div class="spark-progress-fill" data-k="brain-fill"></div></div></div>',
    '<div class="spark-progress-row"><span class="spark-progress-label">SPARK</span><span class="spark-progress-value" data-k="spark"></span><span class="spark-progress-time" data-k="spark-time"></span><div class="spark-progress-track"><div class="spark-progress-fill" data-k="spark-fill"></div></div></div>',
    '</div>',
    '<div class="spark-progress-panel spark-progress-bottom" data-k="bottom-panel">',
    '<div data-k="usage-box">',
    '<div class="spark-usage-row"><span class="spark-usage-label" data-k="usage-primary-label">5H</span><span class="spark-usage-percent" data-k="usage-primary-percent">--</span><span class="spark-usage-reset" data-k="usage-primary-reset"></span></div>',
    '<div class="spark-usage-row"><span class="spark-usage-label" data-k="usage-secondary-label">WK</span><span class="spark-usage-percent" data-k="usage-secondary-percent">--</span><span class="spark-usage-reset" data-k="usage-secondary-reset"></span></div>',
    '</div>',
    '<div data-k="fallback-box" style="display:none">',
    '<div class="spark-telemetry-row"><span>MODEL</span><span data-k="model"></span></div>',
    '<div class="spark-telemetry-row"><span>CHAT</span><span data-k="chat-summary"></span></div>',
    '</div>',
    '</div>',
  ].join('');
}

export function buildProgressExpression(theme, snapshot = {}) {
  const payload = JSON.stringify({
    rootId: PROGRESS_ROOT_ID,
    styleId: PROGRESS_STYLE_ID,
    snapshot: safeSnapshot(snapshot),
    css: progressCss(theme),
    html: progressHtml(),
  });

  return `(async () => {
    const payload = ${payload};
    const now = Date.now();
    const visible = (node) => {
      if (!node) return false;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const controls = Array.from(document.querySelectorAll("button,[role=button]"));
    const stopControl = controls.find((node) => {
      if (!visible(node)) return false;
      const label = [node.getAttribute("aria-label"), node.getAttribute("title"), node.textContent]
        .filter(Boolean).join(" ").trim().toLowerCase();
      return /(^|\\s)(stop|cancel)(\\s|$)/.test(label) && !/stop sharing/.test(label);
    });
    const browserState = globalThis.__sparkProgressState ??= {
      brainStartedAt: null,
      usage: { data: null, fetchedAt: 0, inFlight: null, error: null },
    };
    if (!browserState.usage) {
      browserState.usage = { data: null, fetchedAt: 0, inFlight: null, error: null };
    }
    const brainWorking = Boolean(stopControl);
    if (brainWorking && !browserState.brainStartedAt) browserState.brainStartedAt = now;
    if (!brainWorking) browserState.brainStartedAt = null;
    const brainElapsedMs = browserState.brainStartedAt ? now - browserState.brainStartedAt : 0;
    const formatSeconds = (milliseconds) => {
      const seconds = Math.max(0, Math.floor(milliseconds / 1000));
      const minutes = Math.floor(seconds / 60);
      const remainder = seconds % 60;
      return minutes > 0 ? minutes + ":" + String(remainder).padStart(2, "0") : seconds + "s";
    };
    const formatCompact = (value) => {
      if (!Number.isFinite(value) || value <= 0) return "0";
      if (value >= 1000000) return (value / 1000000).toFixed(value >= 10000000 ? 0 : 1) + "m";
      if (value >= 1000) return (value / 1000).toFixed(value >= 10000 ? 0 : 1) + "k";
      return String(Math.round(value));
    };
    const formatReset = (epochSeconds) => {
      const epoch = Number(epochSeconds);
      if (!Number.isFinite(epoch) || epoch <= 0) return "";
      const date = new Date(epoch * 1000);
      const secondsAway = Math.floor((date.getTime() - Date.now()) / 1000);
      if (secondsAway < 24 * 60 * 60) {
        return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      }
      return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    };
    const usageLabel = (windowMinutes, fallback) => {
      const minutes = Number(windowMinutes);
      if (Math.abs(minutes - 300) <= 1) return "5H";
      if (Math.abs(minutes - 10080) <= 1) return "WK";
      if (Number.isFinite(minutes) && minutes > 0 && minutes % 1440 === 0) return Math.round(minutes / 1440) + "D";
      if (Number.isFinite(minutes) && minutes > 0 && minutes % 60 === 0) return Math.round(minutes / 60) + "H";
      return fallback;
    };
    const parseUsageWindow = (windowValue) => {
      if (!windowValue) return null;
      const usedPercent = Number(windowValue.used_percent ?? 0);
      const windowMinutes = windowValue.limit_window_seconds == null ? null : Number(windowValue.limit_window_seconds) / 60;
      return {
        usedPercent: Number.isFinite(usedPercent) ? usedPercent : 0,
        remainingPercent: Math.max(0, Math.min(100, 100 - (Number.isFinite(usedPercent) ? usedPercent : 0))),
        windowMinutes: Number.isFinite(windowMinutes) ? windowMinutes : null,
        resetAt: windowValue.reset_at ?? null,
      };
    };
    const usageState = browserState.usage;
    const refreshUsage = async () => {
      try {
        const moduleUrl = Array.from(document.querySelectorAll('script[src],link[rel="modulepreload"],link[rel="preload"]'))
          .map((node) => node.src || node.href)
          .find((url) => /\\/assets\\/app-initial-[^/]+\\.js(?:$|\\?)/.test(url || ""));
        if (!moduleUrl) throw new Error("app-initial module not found");
        const appModule = await import(moduleUrl);
        const client = Object.values(appModule).find((candidate) => {
          if (!candidate || typeof candidate !== "object") return false;
          if (typeof candidate.safeGet !== "function" || typeof candidate.safePost !== "function" || typeof candidate.safeDelete !== "function") return false;
          if (typeof candidate.getRequestTarget !== "function") return false;
          try {
            const target = candidate.getRequestTarget("/wham/usage");
            return target?.url === "/wham/usage" && target?.headers?.originator === "Codex Desktop";
          } catch {
            return false;
          }
        });
        if (!client) throw new Error("authenticated ChatGPT request client not found");
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("usage request timeout")), 2500));
        const response = await Promise.race([client.safeGet("/wham/usage"), timeout]);
        const rateLimit = response?.rate_limit ?? null;
        usageState.data = {
          planType: response?.plan_type ?? null,
          primary: parseUsageWindow(rateLimit?.primary_window),
          secondary: parseUsageWindow(rateLimit?.secondary_window),
        };
        usageState.fetchedAt = Date.now();
        usageState.error = null;
      } catch (error) {
        usageState.error = error instanceof Error ? error.message : String(error);
        usageState.fetchedAt = Date.now();
      } finally {
        usageState.inFlight = null;
      }
    };
    if (!usageState.inFlight && (usageState.fetchedAt === 0 || now - usageState.fetchedAt >= 30000)) {
      usageState.inFlight = refreshUsage();
    }
    if (!usageState.data && usageState.inFlight) {
      await usageState.inFlight;
    }

    let style = document.getElementById(payload.styleId);
    if (!style) {
      style = document.createElement("style");
      style.id = payload.styleId;
      document.head?.appendChild(style);
    }
    style.textContent = payload.css;

    let root = document.getElementById(payload.rootId);
    if (!root) {
      root = document.createElement("div");
      root.id = payload.rootId;
      root.setAttribute("aria-hidden", "true");
      root.innerHTML = payload.html;
      document.body?.appendChild(root);
    } else if (!root.querySelector('[data-k="usage-box"]')) {
      root.innerHTML = payload.html;
    }

    const aside = document.querySelector("aside.app-shell-left-panel") || document.querySelector("aside");
    const topPanel = root.querySelector('[data-k="top-panel"]');
    const bottomPanel = root.querySelector('[data-k="bottom-panel"]');
    const modeControl = controls.find((node) => (node.getAttribute("aria-label") || "").startsWith("Switch mode"));
    const searchControl = controls.find((node) => node.getAttribute("aria-label") === "Search");
    const workspaceControl = controls.find((node) => node.getAttribute("aria-label") === "Open profile menu");
    const updateControl = controls.find((node) => node.getAttribute("aria-label") === "Update" || node.getAttribute("title") === "Update");
    if (aside && visible(aside)) {
      const rect = aside.getBoundingClientRect();
      const enoughWidth = rect.width >= 260;
      if (topPanel) {
        const left = Math.ceil(modeControl && visible(modeControl) ? modeControl.getBoundingClientRect().right + 4 : rect.left + 142);
        const right = Math.floor(searchControl && visible(searchControl) ? searchControl.getBoundingClientRect().left - 4 : rect.right - 78);
        const width = Math.max(0, right - left);
        topPanel.style.display = enoughWidth && width >= 92 ? "block" : "none";
        topPanel.style.left = left + "px";
        topPanel.style.width = width + "px";
        topPanel.style.top = rect.top + 5 + "px";
      }
      if (bottomPanel) {
        const left = Math.ceil(workspaceControl && visible(workspaceControl) ? workspaceControl.getBoundingClientRect().right + 2 : rect.right - 130);
        const right = Math.floor(updateControl && visible(updateControl) ? updateControl.getBoundingClientRect().left - 3 : rect.right - 4);
        const width = Math.max(0, right - left);
        const top = workspaceControl && visible(workspaceControl) ? workspaceControl.getBoundingClientRect().top - 1 : rect.bottom - 50;
        bottomPanel.style.display = enoughWidth && width >= 78 ? "block" : "none";
        bottomPanel.style.left = left + "px";
        bottomPanel.style.width = width + "px";
        bottomPanel.style.top = Math.max(rect.top + 5, top) + "px";
      }
    } else {
      if (topPanel) topPanel.style.display = "none";
      if (bottomPanel) bottomPanel.style.display = "none";
    }

    const setText = (key, value) => {
      const node = root.querySelector('[data-k="' + key + '"]');
      if (node) node.textContent = value;
    };
    const brainFill = root.querySelector('[data-k="brain-fill"]');
    if (brainFill) {
      brainFill.className = "spark-progress-fill" + (brainWorking ? " working" : " success");
      if (!brainWorking) brainFill.style.width = "0%";
    }
    setText("brain", brainWorking ? "WORKING" : "IDLE");
    setText("brain-time", brainWorking ? formatSeconds(brainElapsedMs) : "");

    const activity = payload.snapshot.activity ?? {};
    const active = activity.active;
    const pending = activity.pendingUncertainMutation;
    const sparkFill = root.querySelector('[data-k="spark-fill"]');
    if (active) {
      const parsedStart = Date.parse(active.startedAt ?? "");
      const startedAtMs = Number.isFinite(Number(active.startedAtMs)) ? Number(active.startedAtMs) : parsedStart;
      const elapsedMs = Number.isFinite(startedAtMs) ? Math.max(0, now - startedAtMs) : 0;
      const watchdogMs = Number(active.watchdogMs) > 0 ? Number(active.watchdogMs) : 0;
      const percent = watchdogMs > 0 ? Math.min(100, Math.max(0, elapsedMs / watchdogMs * 100)) : 0;
      setText("spark", String(active.operation ?? "operation"));
      setText("spark-time", watchdogMs > 0 ? formatSeconds(elapsedMs) + "/" + formatSeconds(watchdogMs) : formatSeconds(elapsedMs));
      if (sparkFill) {
        sparkFill.className = "spark-progress-fill";
        sparkFill.style.width = percent.toFixed(1) + "%";
      }
    } else if (pending) {
      setText("spark", "UNCERTAIN");
      setText("spark-time", "check");
      if (sparkFill) {
        sparkFill.className = "spark-progress-fill danger";
        sparkFill.style.width = "100%";
      }
    } else if (payload.snapshot.transportError) {
      setText("spark", "OFFLINE");
      setText("spark-time", "");
      if (sparkFill) {
        sparkFill.className = "spark-progress-fill warning";
        sparkFill.style.width = "100%";
      }
    } else {
      setText("spark", "IDLE");
      setText("spark-time", "");
      if (sparkFill) {
        sparkFill.className = "spark-progress-fill success";
        sparkFill.style.width = "0%";
      }
    }

    const usageBox = root.querySelector('[data-k="usage-box"]');
    const fallbackBox = root.querySelector('[data-k="fallback-box"]');
    const usage = usageState.data;
    const hasUsage = Boolean(usage?.primary || usage?.secondary);
    if (usageBox) usageBox.style.display = hasUsage ? "block" : "none";
    if (fallbackBox) fallbackBox.style.display = hasUsage ? "none" : "block";
    if (hasUsage) {
      const primary = usage.primary;
      const secondary = usage.secondary;
      setText("usage-primary-label", usageLabel(primary?.windowMinutes, "P"));
      setText("usage-primary-percent", primary ? Math.round(primary.remainingPercent) + "%" : "--");
      setText("usage-primary-reset", primary ? formatReset(primary.resetAt) : "");
      setText("usage-secondary-label", usageLabel(secondary?.windowMinutes, "S"));
      setText("usage-secondary-percent", secondary ? Math.round(secondary.remainingPercent) + "%" : "--");
      setText("usage-secondary-reset", secondary ? formatReset(secondary.resetAt) : "");
    }

    const modelControl = controls.find((node) => node.getAttribute("aria-label") === "Select ChatGPT model");
    const model = (modelControl?.innerText || modelControl?.textContent || "-").trim().replace(/\\s+/g, " ").slice(0, 18) || "-";
    const turns = Array.from(document.querySelectorAll("[data-turn-key]"));
    const renderedChars = turns.reduce((sum, node) => sum + ((node.innerText || node.textContent || "").length), 0);
    const estimatedTokens = Math.round(renderedChars / 3.2);
    setText("model", model);
    setText("chat-summary", formatCompact(renderedChars) + "C/~" + formatCompact(estimatedTokens) + "T");

    return {
      rootPresent: Boolean(document.getElementById(payload.rootId)),
      brainWorking,
      sparkState: active ? "active" : pending ? "uncertain" : payload.snapshot.transportError ? "offline" : "idle",
      sparkOperation: active?.operation ?? pending?.operation ?? null,
      model,
      renderedChars,
      estimatedTokens,
      sidebarAttached: Boolean(aside && visible(aside)),
      usageAvailable: hasUsage,
      usagePrimaryRemaining: usage?.primary?.remainingPercent ?? null,
      usageSecondaryRemaining: usage?.secondary?.remainingPercent ?? null,
      usagePlanType: usage?.planType ?? null,
      usageError: usageState.error,
    };
  })()`;
}

export function buildProgressRestoreExpression() {
  return `(() => {
    document.getElementById(${JSON.stringify(PROGRESS_ROOT_ID)})?.remove();
    document.getElementById(${JSON.stringify(PROGRESS_STYLE_ID)})?.remove();
    delete globalThis.__sparkProgressState;
    return { restored: true };
  })()`;
}
