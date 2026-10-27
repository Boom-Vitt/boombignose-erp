// Cloud model hosts are refused before any request is built.
const REFUSED = ['api.anthropic.com', 'api.openai.com', 'openrouter.ai'];

/** Example URLs used by the refusal test. They are never requested. */
export function refusedCloudExamples(): string[] {
  return [...REFUSED.map((host) => `https://${host}/v1`), 'https://gateway.openrouter.ai/api/v1'];
}

export function assertNoCloudModelHost(baseUrl: string): void {
  let hostname = '';
  try { hostname = new URL(baseUrl).hostname.toLowerCase(); }
  catch { return; }
  if (REFUSED.includes(hostname) || hostname.endsWith('.openrouter.ai')) {
    throw new Error('Cloud model endpoints are refused. Use Ollama at http://127.0.0.1:11434.');
  }
}
