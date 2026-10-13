// Settings: Providers & models.
import type { Api } from '../api.ts';
import type { Agent, ProviderConfig, Settings } from '../types.ts';
import { badge, btn, confirmBtn, el, field, guarded, load, select, toast } from '../dom.ts';

const HINT: Record<string, string> = {
  anthropic: 'API root, for example https://api.anthropic.com',
  'openai-compatible': 'Chat Completions root, for example https://api.openai.com/v1 or http://127.0.0.1:1234/v1',
};

export function mountProviders(pane: HTMLElement, api: Api, currentAgent?: string, changed: () => void = () => {}): void {
  const reload = () => void load(pane, async () => {
    const [settings, agents] = await Promise.all([api.getSettings(), api.listAgents()]);
    return { ...settings, ...agents };
  }, render);

  function render({ config, secrets, agents }: Settings & { agents: Agent[] }): void {
    const label = (p: ProviderConfig) => p.label || p.id;

    const agent = select(agents.map(a => [a.id, `${a.icon} ${a.name}`]), agents.some(a => a.id === currentAgent) ? currentAgent! : agents[0]?.id ?? '');
    const selected = () => agents.find(a => a.id === agent.value)!;
    const provider = select(config.providers.map((p) => [p.id, label(p)]), selected().provider);
    const model = el('input', { type: 'text', value: selected().model, autocomplete: 'off', spellcheck: 'false' });
    agent.addEventListener('change', () => { provider.value = selected().provider; model.value = selected().model; });
    const active = el('section', { class: 'card' },
      el('h3', {}, 'Agent model'),
      field('Agent', agent), el('div', { class: 'grid2' }, field('Provider', provider), field('Model', model)),
      el('div', { class: 'actions' }, btn('Save', (b) => void guarded(async () => {
        const m = model.value.trim();
        if (!m) throw new Error('Enter a model name');
        await api.patchAgent(agent.value, { provider: provider.value, model: m });
        changed();
        toast('Saved');
        reload();
      }, b), 'primary')));

    const cards = config.providers.map((p) => {
      const url = el('input', { type: 'url', value: p.baseUrl, autocomplete: 'off', spellcheck: 'false' });
      const ctx = el('input', { type: 'number', min: 1000, step: 1000, value: p.contextWindow ?? '' });
      const key = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Paste a new key to replace it' });
      const masked = p.apiKeyEnv ? secrets[p.apiKeyEnv] ?? '' : '';
      const save = btn('Save', (b) => void guarded(async () => {
        let parsed: URL;
        try { parsed = new URL(url.value.trim()); } catch { throw new Error('Base URL is not a valid URL'); }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Base URL must start with http:// or https://');
        const tokens = ctx.value ? Number(ctx.value) : undefined;
        if (tokens !== undefined && !(Number.isInteger(tokens) && tokens > 0)) throw new Error('Context window must be a whole number');
        await api.updateSettings((c) => {
          const t = c.providers.find((x) => x.id === p.id);
          if (!t) throw new Error(`Provider ${p.id} no longer exists`);
          t.baseUrl = url.value.trim();
          if (tokens === undefined) delete t.contextWindow; else t.contextWindow = tokens;
        });
        toast('Saved');
        reload();
      }, b), 'primary');

      const keyRow = p.apiKeyEnv
        ? el('div', { class: 'key-row' },
            el('div', { class: 'key-state' }, 'API key: ', masked ? el('code', {}, masked) : el('span', { class: 'muted' }, 'not set')),
            field('Replace key', key),
            el('div', { class: 'actions' },
              btn('Save key', (b) => void guarded(async () => {
                if (!key.value.trim()) throw new Error('Paste a key first');
                await api.putSecret(p.apiKeyEnv!, key.value.trim());
                key.value = '';
                toast('Key saved');
                reload();
              }, b)),
              masked && confirmBtn('Remove key', (b) => void guarded(async () => { await api.putSecret(p.apiKeyEnv!, ''); reload(); }, b))))
        : el('p', { class: 'muted' }, 'No key needed (local server).');

      return el('section', { class: 'card' },
        el('h3', {}, label(p), badge(p.kind), p.id === selected().provider && badge('Selected', 'ok')),
        el('div', { class: 'grid2' }, field('Base URL', url, HINT[p.kind]), field('Context window (tokens)', ctx)),
        el('div', { class: 'actions' }, save),
        keyRow);
    });

    pane.append(el('h2', {}, 'Providers & models'),
      el('p', { class: 'muted' }, 'Keys are stored in a private file on this Mac and shown masked here.'), active, ...cards);
  }

  reload();
}
