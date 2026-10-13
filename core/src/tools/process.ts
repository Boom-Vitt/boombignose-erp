import { spawn } from 'node:child_process';

export interface CommandResult { stdout: string; stderr: string; code: number | null; reason?: string }
export function runCommand(command: string, opts: { cwd?: string; signal?: AbortSignal; timeoutMs?: number; input?: string; env?: NodeJS.ProcessEnv }): Promise<CommandResult> {
  return new Promise(resolve => {
    if (opts.signal?.aborted) return resolve({ stdout: '', stderr: '', code: null, reason: 'interrupted' });
    const child = spawn('/bin/sh', ['-c', command], { cwd: opts.cwd, env: opts.env ?? process.env, detached: true, stdio: 'pipe' });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let size = 0, reason: string | undefined;
    const capture = (chunks: Buffer[]) => (chunk: Buffer) => {
      if (size >= 100_000) return;
      const kept = Buffer.from(chunk.subarray(0, 100_000 - size));
      chunks.push(kept); size += kept.length;
    };
    child.stdout.on('data', capture(stdout)); child.stderr.on('data', capture(stderr));
    const kill = (why: string) => {
      reason = why;
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    };
    const abort = () => kill('interrupted');
    const timer = setTimeout(() => kill('timeout'), opts.timeoutMs ?? 120_000);
    opts.signal?.addEventListener('abort', abort, { once: true });
    child.on('error', error => { reason = error.message; });
    child.stdin.on('error', () => {}); // a hook may exit before consuming its input
    child.stdin.end(opts.input ?? '');
    child.on('close', code => {
      clearTimeout(timer); opts.signal?.removeEventListener('abort', abort);
      resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), code, ...(reason ? { reason } : {}) });
    });
  });
}
