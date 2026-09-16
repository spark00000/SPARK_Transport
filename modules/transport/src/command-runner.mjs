import { spawn } from 'node:child_process';

const WINDOWS_KILLER_TIMEOUT_MS = 3_000;
const EXIT_DRAIN_GRACE_MS = 250;

function createBoundedCapture(maxBytes) {
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  return {
    push(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, maxBytes - bytes);
      if (buffer.length <= remaining) {
        chunks.push(buffer);
        bytes += buffer.length;
      } else {
        if (remaining > 0) chunks.push(buffer.subarray(0, remaining));
        bytes += remaining;
        truncated = true;
      }
    },
    result() {
      return { text: Buffer.concat(chunks).toString('utf8'), truncated, bytes };
    },
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function terminateProcessTree(pid, child) {
  if (!pid) {
    try { child?.kill('SIGKILL'); } catch {}
    return;
  }

  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      let killer;
      let settled = false;
      let timer;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      try {
        killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } catch {
        finish();
        return;
      }
      killer.once('error', finish);
      killer.once('close', finish);
      timer = setTimeout(() => {
        try { killer?.kill('SIGKILL'); } catch {}
        finish();
      }, WINDOWS_KILLER_TIMEOUT_MS);
    });
    try { child?.kill('SIGKILL'); } catch {}
    return;
  }

  try { process.kill(-pid, 'SIGTERM'); }
  catch { try { child?.kill('SIGTERM'); } catch {} }
  await delay(150);
  try { process.kill(-pid, 'SIGKILL'); }
  catch { try { child?.kill('SIGKILL'); } catch {} }
}

export async function runProcess({ command, args = [], cwd, timeoutMs, maxOutputBytes = 64 * 1024, env = {} }) {
  if (typeof command !== 'string' || !command.trim()) {
    return { ok: false, error: { code: 'INVALID_ARGUMENTS', message: 'command must be a non-empty string' } };
  }
  if (!Array.isArray(args) || !args.every((v) => typeof v === 'string')) {
    return { ok: false, error: { code: 'INVALID_ARGUMENTS', message: 'args must be an array of strings' } };
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    return { ok: false, error: { code: 'INVALID_ARGUMENTS', message: 'timeoutMs must be a positive integer' } };
  }
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    return { ok: false, error: { code: 'INVALID_ARGUMENTS', message: 'maxOutputBytes must be a positive integer' } };
  }

  const startedAt = Date.now();
  return await new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let child;
    let timeoutTimer;
    let exitDrainTimer;
    const stdoutCapture = createBoundedCapture(maxOutputBytes);
    const stderrCapture = createBoundedCapture(maxOutputBytes);

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(exitDrainTimer);
      const stdout = stdoutCapture.result();
      const stderr = stderrCapture.result();
      resolve({
        ...payload,
        stdout: stdout.text,
        stderr: stderr.text,
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
        durationMs: Date.now() - startedAt,
      });
    };

    const finishFromExit = (code, signal) => {
      if (timedOut) {
        finish({
          ok: false,
          error: { code: 'COMMAND_TIMEOUT', message: `command exceeded ${timeoutMs} ms timeout` },
          exitCode: code,
          signal,
        });
        return;
      }
      finish({
        ok: code === 0,
        exitCode: code,
        signal,
        ...(code === 0 ? {} : {
          error: {
            code: 'COMMAND_FAILED',
            message: 'command exited with non-zero status; elevated execution is not attempted automatically',
          },
        }),
      });
    };

    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      const permission = error?.code === 'EACCES' || error?.code === 'EPERM';
      finish({
        ok: false,
        error: {
          code: permission ? 'ELEVATION_REQUIRED_OR_PERMISSION_DENIED' : 'COMMAND_START_FAILED',
          message: permission ? 'command could not start with current non-elevated permissions' : 'command could not be started',
        },
      });
      return;
    }

    child.stdout?.on('data', (d) => stdoutCapture.push(d));
    child.stderr?.on('data', (d) => stderrCapture.push(d));

    child.once('error', (error) => {
      if (timedOut) {
        finishFromExit(child?.exitCode ?? null, child?.signalCode ?? null);
        return;
      }
      const permission = error?.code === 'EACCES' || error?.code === 'EPERM';
      finish({
        ok: false,
        error: {
          code: permission ? 'ELEVATION_REQUIRED_OR_PERMISSION_DENIED' : 'COMMAND_START_FAILED',
          message: permission ? 'command could not start with current non-elevated permissions' : 'command could not be started',
        },
      });
    });

    child.once('exit', (code, signal) => {
      if (settled) return;
      exitDrainTimer = setTimeout(() => {
        try { child.stdout?.destroy(); } catch {}
        try { child.stderr?.destroy(); } catch {}
        finishFromExit(code, signal);
      }, EXIT_DRAIN_GRACE_MS);
    });

    child.once('close', (code, signal) => {
      finishFromExit(code, signal);
    });

    timeoutTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      void (async () => {
        await terminateProcessTree(child.pid, child);
        await delay(EXIT_DRAIN_GRACE_MS);
        if (!settled) {
          try { child.stdout?.destroy(); } catch {}
          try { child.stderr?.destroy(); } catch {}
          finishFromExit(child.exitCode ?? null, child.signalCode ?? null);
        }
      })();
    }, timeoutMs);
  });
}
