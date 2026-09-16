#!/usr/bin/env node

import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluate, listTargets } from "./cdp.mjs";
import { buildProgressExpression } from "./progress.mjs";
import { PROJECT_ROOT, buildApplyExpression, loadTheme } from "./theme.mjs";

function parseArgs(argv) {
  const options = {
    host: "127.0.0.1",
    port: null,
    themePath: undefined,
    intervalMs: 1_500,
    unavailableExitMs: 30_000,
    transportHealthUrl: null,
  };
  const args = [...argv];
  while (args.length > 0) {
    const flag = args.shift();
    const value = args.shift();
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    if (flag === "--host") options.host = value;
    else if (flag === "--port") options.port = Number(value);
    else if (flag === "--theme") options.themePath = path.resolve(value);
    else if (flag === "--interval") options.intervalMs = Number(value);
    else if (flag === "--unavailable-exit") options.unavailableExitMs = Number(value);
    else if (flag === "--transport-health") options.transportHealthUrl = value;
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error("--port must be an integer from 1 to 65535.");
  }
  if (!Number.isInteger(options.intervalMs) || options.intervalMs < 250) {
    throw new Error("--interval must be an integer of at least 250ms.");
  }
  if (options.transportHealthUrl) {
    const parsed = new URL(options.transportHealthUrl);
    const host = parsed.hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
    if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(host)) {
      throw new Error("--transport-health must be a loopback http URL.");
    }
  }
  return options;
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function writeHeartbeat(value) {
  const filePath = path.join(PROJECT_ROOT, ".runtime", "watcher.json");
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

async function readTransportProgress(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(800),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    return {
      checkedAt: new Date().toISOString(),
      activity: body?.activity ?? null,
      transportError: null,
    };
  } catch (error) {
    return {
      checkedAt: new Date().toISOString(),
      activity: null,
      transportError: error?.message ?? String(error),
    };
  }
}

function primaryProgressTarget(targets) {
  return targets.find((target) => target.url === "app://-/index.html")
    ?? targets.find((target) => target.url?.startsWith("app://-/index.html") && !target.url.includes("initialRoute="))
    ?? targets[0]
    ?? null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const theme = await loadTheme(options.themePath);
  const expression = buildApplyExpression(theme);
  let unavailableSince = null;
  let cycle = 0;

  for (;;) {
    cycle += 1;
    try {
      const targets = await listTargets({
        host: options.host,
        port: options.port,
        timeoutMs: Math.min(options.intervalMs, 1_200),
      });
      const progressTarget = primaryProgressTarget(targets);
      const progressSnapshot = await readTransportProgress(options.transportHealthUrl);
      const progressExpression = options.transportHealthUrl
        ? buildProgressExpression(theme, progressSnapshot)
        : null;
      const results = [];
      for (const target of targets) {
        const result = await evaluate(target, expression, { timeoutMs: 5_000 });
        let progress = null;
        if (progressExpression && progressTarget?.id === target.id) {
          progress = await evaluate(target, progressExpression, { timeoutMs: 5_000 });
        }
        results.push({
          targetId: target.id,
          url: target.url,
          result,
          ...(progress ? { progress } : {}),
        });
      }
      unavailableSince = null;
      await writeHeartbeat({
        schemaVersion: 3,
        pid: process.pid,
        cycle,
        healthy: true,
        checkedAt: new Date().toISOString(),
        endpoint: `${options.host}:${options.port}`,
        configPath: options.themePath ?? null,
        theme: { id: theme.id, name: theme.name },
        progress: options.transportHealthUrl ? {
          enabled: true,
          transportHealthUrl: options.transportHealthUrl,
          transport: progressSnapshot,
        } : { enabled: false },
        results,
      });
    } catch (error) {
      unavailableSince ??= Date.now();
      await writeHeartbeat({
        schemaVersion: 3,
        pid: process.pid,
        cycle,
        healthy: false,
        checkedAt: new Date().toISOString(),
        endpoint: `${options.host}:${options.port}`,
        configPath: options.themePath ?? null,
        theme: { id: theme.id, name: theme.name },
        progress: { enabled: Boolean(options.transportHealthUrl) },
        error: error.message,
      });
      if (Date.now() - unavailableSince >= options.unavailableExitMs) {
        throw new Error(
          `CDP endpoint unavailable for ${options.unavailableExitMs}ms: ${error.message}`,
        );
      }
    }
    await delay(options.intervalMs);
  }
}

main().catch((error) => {
  process.stderr.write(
    `chatgpt-ui watcher: ${error.stack ?? error.message}\n`,
  );
  process.exitCode = 1;
});
