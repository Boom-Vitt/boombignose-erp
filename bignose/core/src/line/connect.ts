export interface LineApiOptions {
  accessToken: string; fetchImpl?: typeof fetch; apiBase?: string;
  channelSecret?: string; // Also mask the saved secret if an upstream error echoes it.
}

async function request(o: LineApiOptions, path: string, method: string, body?: unknown): Promise<unknown> {
  const clean = (text: string) => {
    for (const secret of [o.accessToken, o.channelSecret]) if (secret) text = text.replaceAll(secret, '***');
    return text;
  };
  try {
    const res = await (o.fetchImpl ?? fetch)(`${(o.apiBase ?? 'https://api.line.me').replace(/\/+$/, '')}${path}`, {
      method, headers: { Authorization: `Bearer ${o.accessToken}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${clean(text).slice(0, 200)}`);
    return JSON.parse(text || '{}');
  } catch (e) {
    throw new Error(`LINE ${path} failed: ${clean(e instanceof Error ? e.message : String(e))}`);
  }
}

export async function lineBotInfo(o: LineApiOptions): Promise<{ displayName: string; basicId: string; pictureUrl?: string }> {
  const info = await request(o, '/v2/bot/info', 'GET') as Record<string, unknown>;
  if (typeof info?.displayName !== 'string' || typeof info.basicId !== 'string') throw new Error('LINE /v2/bot/info failed: invalid response');
  return { displayName: info.displayName, basicId: info.basicId, ...(typeof info.pictureUrl === 'string' ? { pictureUrl: info.pictureUrl } : {}) };
}

export async function setLineWebhook(o: LineApiOptions, endpoint: string): Promise<void> {
  await request(o, '/v2/bot/channel/webhook/endpoint', 'PUT', { endpoint });
}

/** The "Use webhook" switch of the channel; undefined when LINE does not say. */
export async function lineWebhookActive(o: LineApiOptions): Promise<boolean | undefined> {
  const info = await request(o, '/v2/bot/channel/webhook/endpoint', 'GET') as Record<string, unknown>;
  return typeof info?.active === 'boolean' ? info.active : undefined;
}

export async function testLineWebhook(o: LineApiOptions, endpoint: string): Promise<{
  success: boolean; statusCode?: number; reason?: string; detail?: string; timestamp?: string;
}> {
  const result = await request(o, '/v2/bot/channel/webhook/test', 'POST', { endpoint }) as Record<string, unknown>;
  if (typeof result?.success !== 'boolean') throw new Error('LINE /v2/bot/channel/webhook/test failed: invalid response');
  return { success: result.success, ...(typeof result.statusCode === 'number' ? { statusCode: result.statusCode } : {}),
    ...(typeof result.reason === 'string' ? { reason: result.reason } : {}), ...(typeof result.detail === 'string' ? { detail: result.detail } : {}),
    ...(typeof result.timestamp === 'string' ? { timestamp: result.timestamp } : {}) };
}

export function publicUrlProblem(url: string): string | undefined {
  if (url.length > 480) return 'Public URL must be at most 480 characters.';
  let parsed: URL;
  try { parsed = new URL(url); } catch { return 'Public URL must be a valid HTTPS URL.'; }
  if (parsed.protocol !== 'https:') return 'Public URL must use HTTPS.';
  if (parsed.username || parsed.password) return 'Public URL must not include credentials.';
  if (url.includes('?') || url.includes('#')) return 'Public URL must not include a query or fragment.';
  return undefined;
}

export const webhookUrlFor = (publicUrl: string): string => publicUrl.replace(/\/+$/, '') + '/line/webhook';
