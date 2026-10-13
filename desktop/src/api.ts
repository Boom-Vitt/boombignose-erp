// The only module that knows the local API's routes (docs/design.md section 6). No DOM.
import type {
  Config, Health, Job, Delivery, LineStatus, McpServerConfig, McpServerInfo, McpToolInfo, MemoryKind,
  MemoryNote, SessionDetail, SessionSummary, Settings, Skill, SkillSummary, Status, TestResult,
} from './types.ts';

export class ApiError extends Error {
  status: number; // 0 = the daemon could not be reached
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface ApiOptions { port: number; token: string; fetch?: typeof fetch }
type Query = Record<string, string | number | undefined>;
type Req = { query?: Query; body?: unknown; signal?: AbortSignal };

const FALLBACK: Record<number, string> = {
  401: 'The daemon rejected the API token',
  403: 'The daemon refused the request',
  404: 'Not found',
  409: 'A run is already active in this chat',
  413: 'Request too large',
};

const enc = encodeURIComponent;

export function createApi(opts: ApiOptions) {
  const base = `http://127.0.0.1:${opts.port}`;
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const auth = { Authorization: `Bearer ${opts.token}` };

  function url(path: string, query?: Query): string {
    const u = new URL(path, base);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
    return u.toString();
  }

  async function send(method: string, path: string, r: Req = {}, accept = 'application/json'): Promise<Response> {
    const headers: Record<string, string> = { ...auth, Accept: accept };
    if (r.body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      return await doFetch(url(path, r.query), {
        method, headers, signal: r.signal, body: r.body === undefined ? undefined : JSON.stringify(r.body),
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      throw new ApiError(0, 'Cannot reach the BigNose daemon');
    }
  }

  async function call<T>(method: string, path: string, r: Req = {}): Promise<T> {
    const res = await send(method, path, r);
    const text = await res.text();
    let json: unknown;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    if (!res.ok) {
      const msg = json && typeof json === 'object' && 'error' in json ? String((json as { error: unknown }).error) : '';
      throw new ApiError(res.status, msg || FALLBACK[res.status] || `HTTP ${res.status}`);
    }
    return json as T;
  }

  const get = <T>(path: string, query?: Query) => call<T>('GET', path, { query });
  const post = <T>(path: string, body?: unknown) => call<T>('POST', path, { body: body ?? {} });
  const put = <T>(path: string, body: unknown) => call<T>('PUT', path, { body });
  const patch = <T>(path: string, body: unknown) => call<T>('PATCH', path, { body });
  const del = <T = { ok: boolean }>(path: string) => call<T>('DELETE', path);

  const api = {
    health: () => get<Health>('/api/health'),
    status: () => get<Status>('/api/status'),
    /** Raw stream for GET /api/events (EventSource cannot send the Authorization header). */
    events: (signal: AbortSignal) => send('GET', '/api/events', { signal }, 'text/event-stream'),

    listSessions: (q?: string, limit?: number) => get<{ sessions: SessionSummary[] }>('/api/sessions', { q, limit }),
    createSession: (title?: string) => post<{ id: string }>('/api/sessions', title ? { title } : {}),
    getSession: (id: string) => get<SessionDetail>(`/api/sessions/${enc(id)}`),
    deleteSession: (id: string) => del(`/api/sessions/${enc(id)}`),
    sendMessage: (id: string, text: string) => post<{ runId: string }>(`/api/sessions/${enc(id)}/messages`, { text }),
    interrupt: (id: string) => post<{ ok: boolean }>(`/api/sessions/${enc(id)}/interrupt`),
    decideApproval: (id: string, allow: boolean) => post<{ ok: boolean }>(`/api/approvals/${enc(id)}`, { allow }),

    getSettings: () => get<Settings>('/api/settings'),
    putSettings: (config: Config) => put<Settings>('/api/settings', { config }),
    /** Read-modify-write on a fresh copy, so one screen never overwrites what another saved. */
    async updateSettings(mutate: (config: Config) => void): Promise<Settings> {
      const { config } = await api.getSettings();
      mutate(config);
      return api.putSettings(config);
    },
    /** An empty value deletes the secret. */
    putSecret: (name: string, value: string) => put<{ name: string; masked: string }>('/api/secrets', { name, value }),

    listMcp: () => get<{ servers: McpServerInfo[] }>('/api/mcp'),
    addMcp: (name: string, config: McpServerConfig) => post<unknown>('/api/mcp', { name, config }),
    patchMcp: (name: string, change: { enabled?: boolean; tools?: string[] }) => patch<unknown>(`/api/mcp/${enc(name)}`, change),
    deleteMcp: (name: string) => del(`/api/mcp/${enc(name)}`),
    testMcp: (name: string) => post<TestResult>(`/api/mcp/${enc(name)}/test`),
    mcpTools: (name: string) => get<{ tools: McpToolInfo[] }>(`/api/mcp/${enc(name)}/tools`),

    listSkills: () => get<{ skills: SkillSummary[] }>('/api/skills'),
    getSkill: (name: string) => get<Skill>(`/api/skills/${enc(name)}`),
    putSkill: (name: string, skill: { description: string; body: string }) => put<unknown>(`/api/skills/${enc(name)}`, skill),
    deleteSkill: (name: string) => del(`/api/skills/${enc(name)}`),

    listMemory: (kind?: MemoryKind, q?: string) => get<{ notes: MemoryNote[] }>('/api/memory', { kind, q }),
    addMemory: (kind: MemoryKind, text: string) => post<unknown>('/api/memory', { kind, text }),
    updateMemory: (id: string | number, text: string) => put<unknown>(`/api/memory/${enc(String(id))}`, { text }),
    deleteMemory: (id: string | number) => del(`/api/memory/${enc(String(id))}`),

    listSchedules: () => get<{ jobs: Job[] }>('/api/schedules'),
    addSchedule: (job: { cron: string; prompt: string; delivery: Delivery }) => post<unknown>('/api/schedules', job),
    setScheduleEnabled: (id: string, enabled: boolean) => patch<unknown>(`/api/schedules/${enc(id)}`, { enabled }),
    deleteSchedule: (id: string) => del(`/api/schedules/${enc(id)}`),

    lineStatus: () => get<LineStatus>('/api/line/status'),
  };
  return api;
}

export type Api = ReturnType<typeof createApi>;
