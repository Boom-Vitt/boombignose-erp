// Settings › Model: where BigNose runs, the default model, and the limits behind one More options fold.
import type { Api } from '../api.ts';
import type { Agent, ModelListResult, ProviderConfig, ProviderStatus, Settings } from '../types.ts';
import { modelField } from '../models.ts';
import { badge, btn, confirmDialog, copyText, el, errMsg, field, guarded, icon, load, select, toast } from '../dom.ts';
import { checkLimits, generalFromConfig } from './forms.ts';
import type { Change } from './forms.ts';
import { row, saveBar } from './parts.ts';

const HINT: Record<string, string> = {
  anthropic: 'Cloud providers are refused. Use Ollama at http://127.0.0.1:11434/v1',
  'openai-compatible': 'Chat Completions root on this machine, for example http://127.0.0.1:11434/v1',
};
const COMPACT: [string, string][] = [['0.6', '60%'], ['0.8', '80%'], ['0.9', '90%']];
const percent = (v: string) => COMPACT.find(([value]) => value === v)?.[1] ?? `${Math.round(Number(v) * 100)}%`;
const isLocal = (p: ProviderConfig) => {
  if (p.id === 'ollama') return true;
  try { return new URL(p.baseUrl).port === '11434'; } catch { return false; }
};
const failed = (e: unknown): ModelListResult => ({ ok: false, models: [], error: errMsg(e) });

export function mountModel(pane: HTMLElement, api: Api, changed: () => void = () => {}): void {
  const fetchData = async () => {
    const [settings, agents] = await Promise.all([api.getSettings(), api.listAgents()]);
    const local = settings.config.providers.find(isLocal);
    const [status, mac] = local ? await Promise.all([
      api.providerStatus(local.id).catch((e): ProviderStatus => ({ warnings: [errMsg(e)] })),
      api.listModels(local.id).catch(failed),
    ]) : [undefined, undefined];
    return { ...settings, ...agents, status, mac };
  };
  const reload = () => void load(pane, fetchData, render);

  function render({ config, secrets, status, mac }: Settings & { agents: Agent[]; status?: ProviderStatus; mac?: ModelListResult }): void {
    const local = config.providers.find(isLocal);
    const clouds = config.providers.filter((p) => p !== local);
    const label = (p: ProviderConfig) => p.label || p.id;
    const byId = (id: string) => config.providers.find((p) => p.id === id)!;
    const active = byId(config.active.provider);
    let mode: 'mac' | 'cloud' = local && (active === local || !clouds.length) ? 'mac' : 'cloud';

    // `provider` is the select modelField watches; `service` is the one the owner sees (cloud services only)
    const provider = select(config.providers.map((p) => [p.id, label(p)]), active.id);
    const service = select(clouds.map((p) => [p.id, label(p)]), clouds.includes(active) ? active.id : clouds[0]?.id ?? '');
    const model = el('input', { type: 'text', value: config.active.model, autocomplete: 'off', spellcheck: 'false' });
    const models = modelField(api, provider, model, 'provider-models');
    const general = generalFromConfig(config);
    const maxTurns = el('input', { type: 'number', value: general.maxTurns, required: true, min: 1, step: 1 });
    const compact = select([...COMPACT, ...(COMPACT.some(([v]) => v === general.compactAt) ? [] : [[general.compactAt, percent(general.compactAt)] as [string, string]])], general.compactAt);
    const ctx = el('input', { type: 'number', min: 1000, step: 1 });
    const url = el('input', { type: 'url', autocomplete: 'off', spellcheck: 'false' });
    const key = el('input', { type: 'password', autocomplete: 'new-password' });
    const optKey = el('input', { type: 'password', autocomplete: 'new-password' });

    // context window and address are kept per provider while the owner switches between them
    const draft = Object.fromEntries(config.providers.map((p) => [p.id, { ctx: String(p.contextWindow ?? ''), url: p.baseUrl }]));
    const saved = structuredClone(draft);
    const syncDraft = () => { const d = draft[provider.value]!; d.ctx = ctx.value; d.url = url.value; };
    const current = () => byId(provider.value);
    const keyHint = (p: ProviderConfig) => !p.apiKeyEnv ? 'This server needs no key.'
      : secrets[p.apiKeyEnv] ? `Saved as ${secrets[p.apiKeyEnv]}. Paste a new key to replace it.` : 'Not set yet. Keys stay in a private file on this Mac.';

    // ---- Runs on
    const choice = (value: string, glyph: string, title: string, desc: string, on: boolean, off: boolean, extra?: Node) => {
      const input = el('input', { type: 'radio', name: 'runs', value, checked: on, disabled: off });
      return { input, root: el('label', { class: 'choice' }, input, icon(glyph), el('strong', {}, title), el('span', { class: 'choice-desc' }, desc), extra, el('span', { class: 'choice-tick' }, icon('check'))) };
    };
    const macChoice = choice('mac', 'laptop', 'This Mac', 'Free and private. Uses Ollama.', mode === 'mac', !local,
      local && (mac?.ok ? badge('Running', 'ok') : badge('Not running', 'warn')));
    const cloudChoice = choice('cloud', 'cloud', 'A cloud service', 'Bigger models. Needs an API key.', mode === 'cloud', !clouds.length);
    const runs = el('fieldset', { class: 'choices' }, el('legend', { class: 'group-title' }, 'Runs on'), macChoice.root, cloudChoice.root);

    // ---- the default model card
    const serviceField = field('Service', service);
    const keyField = field('API key', key);
    const keyNote = el('div', { class: 'hint' });
    keyField.append(keyNote);
    const testIcon = el('span', { class: 'test-icon' });
    const testText = el('div', { class: 'row-text' });
    const testBtn = btn('Test', () => void check(), 'quiet small');
    const testLine = el('div', { class: 'row test-line', role: 'status' }, testIcon, testText, testBtn);
    const card = el('div', { class: 'card' }, serviceField, keyField, models, testLine);

    // ---- More options
    const ctxField = field('Context window', ctx, 'How much the model can read at once, in tokens. Leave blank for the default.');
    const ctxNotes = el('div', { hidden: true }, ...(status?.note ? [el('div', { class: 'hint' }, status.note)] : []),
      ...(status?.warnings ?? []).map((w) => el('div', { class: 'notice warn' }, w)));
    ctxField.append(ctxNotes);
    const addrField = field('Ollama address', url);
    const addrHint = el('div', { class: 'hint' });
    addrField.append(addrHint);
    const optKeyField = field('API key (optional)', optKey);
    const optKeyNote = el('div', { class: 'hint' });
    optKeyField.append(optKeyNote);
    // A saved key can be cleared here. It asks first, deletes the key from the private file, and keeps whatever else was typed in the form.
    const savedKey = el('span');
    const removeKey = btn('Remove key', () => void (async () => {
      const p = current(), name = p.apiKeyEnv;
      if (!name || !await confirmDialog({ title: `Remove the ${label(p)} key?`, body: 'It is deleted from this Mac. Paste a new key to use the service again.', action: 'Remove key' })) return;
      await guarded(async () => { await api.putSecret(name, ''); secrets[name] = ''; showProvider(); untested(); toast('Key removed'); });
    })(), 'quiet small danger');
    const removeRow = row('Saved key', savedKey, removeKey);
    const result = el('div', { 'aria-live': 'polite' });
    const run = btn('Run diagnostics', runDiagnostics, 'small');
    const more = el('details', { class: 'card disclosure' },
      el('summary', {}, icon('chev-r'), 'More options', el('span', { class: 'row-sub' }, 'Context, steps, address, diagnostics')),
      el('div', {}, ctxField,
        field('Most steps per answer', maxTurns, 'The most model calls in one answer.'),
        field('Summarise older messages at', compact, 'When a chat fills this much of the context window, older messages are summarised.'),
        addrField, optKeyField, removeRow,
        row('Diagnostics', 'Checks the model, the folder and LINE.', run), result));

    // ---- what the owner picked decides which parts show
    const showProvider = () => {
      const p = current(), d = draft[p.id]!, onMac = mode === 'mac';
      ctx.value = d.ctx; url.value = d.url;
      (addrField.querySelector('.field-label') as HTMLElement).textContent = onMac ? 'Ollama address' : 'Server address';
      addrHint.textContent = HINT[p.kind] ?? '';
      serviceField.hidden = onMac; keyField.hidden = onMac || !p.apiKeyEnv; optKeyField.hidden = !onMac || !p.apiKeyEnv;
      ctxNotes.hidden = !isLocal(p);
      keyNote.textContent = optKeyNote.textContent = keyHint(p);
      const masked = p.apiKeyEnv ? secrets[p.apiKeyEnv] : '';
      removeRow.hidden = !masked; savedKey.textContent = masked ? `Saved as ${masked}.` : '';
      key.setAttribute('placeholder', 'Paste your key'); optKey.setAttribute('placeholder', 'Paste a key to set or replace it');
    };
    const pick = (next: 'mac' | 'cloud') => {
      syncDraft();
      mode = next;
      provider.value = next === 'mac' ? local!.id : service.value;
      key.value = optKey.value = '';
      showProvider(); void models.reload(); untested(); refresh();
    };
    macChoice.input.addEventListener('change', () => { if (macChoice.input.checked) pick('mac'); });
    cloudChoice.input.addEventListener('change', () => { if (cloudChoice.input.checked) pick('cloud'); });
    service.addEventListener('change', () => { syncDraft(); provider.value = service.value; key.value = ''; showProvider(); void models.reload(); untested(); refresh(); });
    model.addEventListener('input', untested);
    for (const input of [url, key, optKey]) input.addEventListener('input', untested);

    // ---- the test line: until the core can send a test message, it checks that the server answers and has the model
    let seq = 0;
    function setLine(state: 'idle' | 'testing' | 'ok' | 'bad', text: string, action: string): void {
      testLine.className = state === 'bad' ? 'row test-line bad' : 'row test-line';
      testIcon.replaceChildren(...(state === 'ok' ? [icon('check')] : state === 'bad' ? [icon('x')] : state === 'testing' ? [el('span', { class: 'spin' })] : []));
      testText.textContent = text; testBtn.textContent = action; testBtn.disabled = state === 'testing';
    }
    // Test asks the daemon, which uses the saved address and key: with unsaved ones the result would belong to the old values
    const unsaved = () => [url.value.trim() !== saved[provider.value]!.url.trim() && 'address', (mode === 'mac' ? optKey : key).value.trim() && 'key'].filter(Boolean).join(' and ');
    function untested(): void {
      seq++;
      const what = unsaved();
      setLine('idle', what ? `Save to test the new ${what}.` : 'Not tested yet.', 'Test');
      testBtn.disabled = !!what;
    }
    async function check(): Promise<void> {
      if (unsaved()) { untested(); return; }
      const mine = ++seq, name = model.value.trim();
      if (!name) { setLine('idle', 'Enter a model name first.', 'Test'); return; }
      setLine('testing', `Testing ${name}…`, 'Test');
      const r = await api.listModels(current().id).catch(failed);
      if (mine === seq) judge(r);
    }
    function judge(r: ModelListResult): void {
      const name = model.value.trim(), p = current(), n = r.models.length;
      if (!r.ok) setLine('bad', mode === 'mac' ? "Ollama isn't running. Open Ollama, then try again." : `Couldn't reach ${label(p)}: ${r.error || 'no answer'}`, 'Test again');
      else if (mode === 'mac' && !r.models.some((m) => m.id === name || m.id === `${name}:latest`)) setLine('bad', `${name} isn't on this Mac. Run \`ollama pull ${name}\`, or pick another model.`, 'Test again');
      else setLine('ok', mode === 'mac' ? `Ollama is running · ${n} model${n === 1 ? '' : 's'} on this Mac` : `Reached ${label(p)}${n ? ` · ${n} models` : ''}`, 'Check again');
    }

    // ---- diagnostics: a warning is not a pass
    function runDiagnostics(): void {
      if (run.disabled) return;
      void guarded(async () => {
        result.replaceChildren(el('p', { class: 'muted pad' }, 'Running diagnostics…'));
        try {
          const { code, lines } = await api.doctor();
          const warn = lines.some((l) => l.startsWith('warn '));
          const [tone, verdict] = code !== 0 ? ['bad', 'Some checks failed'] : warn ? ['warn', 'Some checks need attention'] : ['ok', 'All checks passed'];
          result.replaceChildren(
            el('div', { class: 'row' }, el('p', { class: `result ${tone}` }, verdict), btn('Copy', () => copyText(lines.join('\n')), 'quiet small')),
            el('pre', { class: 'diag' }, lines.join('\n')));
        } catch (e) {
          result.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, el('p', {}, errMsg(e)), btn('Retry', runDiagnostics)));
        }
      }, run);
    }

    // ---- the save bar
    const runsText = () => (mode === 'mac' ? 'This Mac' : label(byId(service.value)));
    const firstRuns = runsText();
    const bar = saveBar(reload);
    function changes(): Change[] {
      syncDraft();
      const out: Change[] = [];
      const add = (l: string, from: string, to: string) => { if (from !== to) out.push({ label: l, from, to }); };
      add('Runs on', firstRuns, runsText());
      add('Model', config.active.model, model.value.trim());
      if ((mode === 'mac' ? optKey : key).value.trim()) out.push({ label: 'API key', secret: true });
      const moved = (f: 'ctx' | 'url') => config.providers.find((p) => draft[p.id]![f] !== saved[p.id]![f]);
      const c = moved('ctx'), u = moved('url');
      if (c) add('Context window', saved[c.id]!.ctx, draft[c.id]!.ctx);
      if (u) add(isLocal(u) ? 'Ollama address' : 'Server address', saved[u.id]!.url, draft[u.id]!.url);
      add('Most steps per answer', general.maxTurns, maxTurns.value.trim());
      add('Summarise older messages at', percent(general.compactAt), percent(compact.value));
      return out;
    }
    function refresh(): void { bar.set(changes()); }

    const form = el('form', { class: 'model-form' }, runs, el('h2', { class: 'group-title' }, 'Default model'), card,
      el('p', { class: 'group-foot' }, 'Every agent uses this model unless you pick another one for that agent.'), more, bar.root);
    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      syncDraft();
      void guarded(async () => {
        const name = model.value.trim();
        if (!name) throw new Error('Enter a model name');
        const limits = checkLimits({ maxTurns: maxTurns.value, compactAt: compact.value });
        const edits = config.providers.filter((p) => draft[p.id]!.ctx !== saved[p.id]!.ctx || draft[p.id]!.url !== saved[p.id]!.url).map((p) => {
          const d = draft[p.id]!, address = d.url.trim();
          let parsed: URL;
          try { parsed = new URL(address); } catch { throw new Error(`${label(p)}: the address is not a valid URL`); }
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`${label(p)}: the address must start with http:// or https://`);
          const tokens = d.ctx.trim() ? Number(d.ctx) : undefined;
          if (tokens !== undefined && !(Number.isInteger(tokens) && tokens > 0)) throw new Error('Context window must be a whole number');
          return { id: p.id, address, tokens };
        });
        const chosen = current(), secret = (mode === 'mac' ? optKey : key).value.trim();
        if (secret) {
          if (!chosen.apiKeyEnv) throw new Error(`${label(chosen)} takes no key`);
          await api.putSecret(chosen.apiKeyEnv, secret);
        }
        const before = { ...config.active };
        await api.updateSettings((c) => {
          for (const e of edits) {
            const t = c.providers.find((x) => x.id === e.id);
            if (!t) throw new Error(`Provider ${e.id} no longer exists`);
            t.baseUrl = e.address;
            if (e.tokens === undefined) delete t.contextWindow; else t.contextWindow = e.tokens;
          }
          c.active = { provider: chosen.id, model: name };
          Object.assign(c.agent, limits);
        });
        // agents that followed the old Settings model follow the new one (the agent form calls that "Same as Settings")
        const stayed: string[] = [];
        if (before.provider !== chosen.id || before.model !== name) {
          for (const a of (await api.listAgents()).agents) {
            if (a.provider !== before.provider || a.model !== before.model) continue;
            try { await api.patchAgent(a.id, { provider: chosen.id, model: name }); } catch { stayed.push(a.name); }
          }
        }
        changed();
        toast('Saved');
        if (stayed.length) toast(`${stayed.join(', ')} could not be moved to ${name} and still use ${before.model}. Change ${stayed.length === 1 ? 'it' : 'them'} on the Agents page.`, 'error');
        reload();
      }, bar.submit);
    });

    pane.append(form);
    showProvider();
    if (mode === 'mac' && mac) judge(mac); else void check(); // the load already asked Ollama, so the saved model is judged from that answer
  }

  reload();
}
