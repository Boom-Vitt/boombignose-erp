// Separate form logic from the DOM so credential allocation can be checked before writes.
import type { Api } from '../api.ts';
import type { McpServerConfig, Settings } from '../types.ts';

export interface ConnectorForm {
  name: string; transport: 'stdio' | 'http'; command: string; args: string; url: string; pairs: [string, string][];
}

// Hex components preserve case/punctuation; the separator cannot occur inside either component.
export function secretName(server: string, key: string): string {
  const hex = (s: string) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `MCP_${hex(server)}_${hex(key)}`;
}

export function prepareConnector(form: ConnectorForm, settings: Settings) {
  const name = form.name.trim();
  if (!/^[A-Za-z0-9-]{1,32}$/.test(name)) throw new Error('Name: 1 to 32 letters, digits or "-"');
  if (Object.hasOwn(settings.config.mcp.servers, name)) throw new Error(`A connector named ${name} already exists`);
  let config: McpServerConfig;
  if (form.transport === 'stdio') {
    const command = form.command.trim();
    if (!command) throw new Error('Enter a command');
    const args = (form.args.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((a) => a.replace(/^(["'])(.*)\1$/, '$2'));
    config = { transport: 'stdio', command, args, enabled: true };
  } else {
    let url: URL;
    try { url = new URL(form.url.trim()); } catch { throw new Error('Enter a valid URL'); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The URL must start with http:// or https://');
    config = { transport: 'http', url: url.toString(), enabled: true };
  }

  const reserved = new Set(Object.keys(settings.secrets).filter((n) => settings.secrets[n]));
  for (const provider of settings.config.providers) if (provider.apiKeyEnv) reserved.add(provider.apiKeyEnv);
  for (const server of Object.values(settings.config.mcp.servers)) {
    for (const value of Object.values(server.transport === 'stdio' ? server.env ?? {} : server.headers ?? {})) {
      for (const match of value.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)) reserved.add(match[1]);
    }
  }
  const seen = new Set<string>();
  const secrets: { name: string; value: string }[] = [];
  const refs = form.pairs.map(([rawKey, rawValue]) => {
    const key = rawKey.trim();
    const value = rawValue.trim();
    const valid = form.transport === 'stdio' ? /^[A-Za-z_][A-Za-z0-9_]*$/ : /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
    if (!valid.test(key)) throw new Error(`"${key}" is not a valid ${form.transport === 'stdio' ? 'environment variable' : 'header'} name`);
    if (!value) throw new Error(`Enter a value for ${key}`);
    if (/[\r\n]/.test(value)) throw new Error(`The value for ${key} must not contain a newline`);
    const canonical = form.transport === 'http' ? key.toLowerCase() : key;
    if (seen.has(canonical)) throw new Error(`Duplicate name: ${key}`);
    seen.add(canonical);
    const envName = secretName(name, key);
    if (reserved.has(envName)) throw new Error(`Secret ${envName} is already in use; choose another connector or variable name`);
    secrets.push({ name: envName, value });
    return [key, '${' + envName + '}'];
  });
  if (refs.length) {
    if (config.transport === 'stdio') config.env = Object.fromEntries(refs);
    else config.headers = Object.fromEntries(refs);
  }
  return { name, config, secrets };
}

export async function addConnector(api: Api, form: ConnectorForm): Promise<void> {
  const { name, config, secrets } = prepareConnector(form, await api.getSettings());
  await api.addMcp(name, { ...config, enabled: !secrets.length });
  if (!secrets.length) return;
  try {
    for (const secret of secrets) await api.putSecret(secret.name, secret.value);
    await api.patchMcp(name, { enabled: true });
  } catch (error) {
    try {
      await api.deleteMcp(name);
      for (const secret of secrets) await api.putSecret(secret.name, '');
    } catch {
      throw new Error(`Connector ${name} setup failed and cleanup was incomplete. Check the connector before retrying.`, { cause: error });
    }
    throw error;
  }
}

export async function deleteConnector(api: Api, name: string): Promise<void> {
  const { config, secrets } = await api.getSettings();
  const referenced = new Set(config.providers.flatMap(p => p.apiKeyEnv ? [p.apiKeyEnv] : []));
  for (const [serverName, server] of Object.entries(config.mcp.servers)) {
    if (serverName === name) continue;
    for (const value of Object.values(server.transport === 'stdio' ? server.env ?? {} : server.headers ?? {})) {
      for (const match of value.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)) referenced.add(match[1]);
    }
  }
  await api.deleteMcp(name);
  const prefix = secretName(name, '');
  for (const secret of Object.keys(secrets)) {
    if (secret.startsWith(prefix) && /^[0-9A-F]+$/.test(secret.slice(prefix.length)) && !referenced.has(secret))
      await api.putSecret(secret, '');
  }
}
