// Settings: Messaging (LINE only).
import type { Api } from '../api.ts';
import type { LineStatus, Settings } from '../types.ts';
import { badge, btn, check, el, errMsg, field, formatTime, guarded, load, toast } from '../dom.ts';

// names of the secrets in the daemon's .env
const ACCESS_NAME = 'LINE_CHANNEL_ACCESS_TOKEN';
const CHANNEL_NAME = 'LINE_CHANNEL_SECRET';
const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

function ids(label: string, prefix: string, list: string[]): { box: HTMLTextAreaElement; root: HTMLElement; value(): string[] } {
  const box = el('textarea', { rows: 3, spellcheck: 'false', autocomplete: 'off', placeholder: `${prefix}…` });
  box.value = list.join('\n');
  return {
    box,
    root: field(label, box, `One ID per line, starting with ${prefix}`),
    value() {
      const out = lines(box.value);
      const bad = out.find((i) => !i.startsWith(prefix));
      if (bad) throw new Error(`${label}: "${bad}" does not start with ${prefix}`);
      return out;
    },
  };
}

export function mountMessaging(pane: HTMLElement, api: Api): void {
  const reload = () => void load(pane, () => Promise.all([api.getSettings(), api.lineStatus()]), ([s, st]) => render(s, st));

  function render({ config, secrets }: Settings, st: LineStatus): void {
    const line = config.line;
    const connectResult = el('div', { class: 'line-connect-result', role: 'status' });
    const testResult = el('div', { class: 'line-test-result', role: 'status' });
    const connect = btn('Connect', b => void guarded(async () => {
      connectResult.replaceChildren();
      try {
        const result = await api.lineConnect();
        connectResult.replaceChildren(
          ...result.steps.map(s => el('p', { class: s.ok ? 'muted' : 'notice error' }, `${s.name === 'token' ? 'Token' : 'Webhook'}: ${s.ok ? 'ok' : 'failed'} — ${s.detail}`)),
          ...(result.bot ? [el('p', {}, `${result.bot.displayName} (${result.bot.basicId})`)] : []));
        renderStatus(await api.lineStatus());
      } catch (e) { connectResult.replaceChildren(el('p', { class: 'notice error' }, errMsg(e))); }
    }, b));
    const test = btn('Test webhook', b => void guarded(async () => {
      testResult.replaceChildren();
      try {
        const result = await api.lineTest();
        testResult.replaceChildren(el('p', { class: result.ok ? 'muted' : 'notice error' }, `Test: ${result.ok ? 'ok' : 'failed'}`),
          ...(result.statusCode !== undefined ? [el('p', {}, `LINE status code: ${result.statusCode}`)] : []),
          el('p', {}, result.detail));
      } catch (e) { testResult.replaceChildren(el('p', { class: 'notice error' }, errMsg(e))); }
    }, b));

    const details = el('div');
    function renderStatus(st: LineStatus): void {
      const webhook = st.webhookUrl || '';
      details.replaceChildren(el('div', {},
        el('h3', {}, 'Status', badge(st.enabled ? 'Enabled' : 'Disabled', st.enabled ? 'ok' : ''), badge(st.running ? 'Local listener running' : 'Local listener stopped', st.running ? 'ok' : 'warn')),
        el('div', { class: 'badges' }, badge(st.tokenSet ? 'Access token set' : 'Access token missing', st.tokenSet ? 'ok' : 'bad'), badge(st.secretSet ? 'Channel secret set' : 'Channel secret missing', st.secretSet ? 'ok' : 'bad')),
        el('div', { class: 'field' }, el('label', {}, el('span', { class: 'field-label' }, 'Webhook URL'), el('input', { type: 'text', readonly: true, value: webhook, placeholder: 'Set a public URL below' })),
          webhook && btn('Copy', (b) => void guarded(async () => { await navigator.clipboard.writeText(webhook); toast('Copied'); }, b), 'small')),
        st.healthUrl && el('p', { class: 'hint' }, `Open ${st.healthUrl} in a browser to check your tunnel.`),
        ...(st.warnings ?? []).map(w => el('p', { class: 'notice warn' }, w)),
        st.lastEventAt && el('p', { class: 'muted' }, `Last event: ${formatTime(st.lastEventAt)}`),
        st.lastError && el('p', { class: 'notice error' }, st.lastError)));
    }
    renderStatus(st);
    const status = el('section', { class: 'card' }, details,
      el('div', { class: 'actions' }, connect, test, btn('Refresh', reload)), connectResult, testResult);

    const enabled = check('Enable the LINE gateway', line.enabled);
    const token = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Paste to replace' });
    const secret = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Paste to replace' });
    const port = el('input', { type: 'number', min: 1, max: 65535, value: line.port });
    const publicUrl = el('input', { type: 'url', value: line.publicUrl ?? '', placeholder: 'https://your-tunnel.example.com', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'line-public-url-error' });
    const urlError = el('div', { id: 'line-public-url-error', class: 'notice error', role: 'alert', hidden: true });
    const urlField = field('Public URL', publicUrl, 'A public HTTPS address (for example a tunnel) that forwards to the local port. LINE calls <URL>/line/webhook.');
    urlField.append(urlError);
    function validateUrl(): boolean {
      const pub = publicUrl.value.trim();
      let error = '';
      if (pub) {
        if (!pub.startsWith('https://')) error = 'Public URL must start with https://';
        else {
          try { new URL(pub); } catch { error = 'Public URL is not a valid URL'; }
        }
      }
      urlError.textContent = error; urlError.hidden = !error;
      publicUrl.setAttribute('aria-invalid', String(!!error));
      return !error;
    }
    publicUrl.addEventListener('input', validateUrl);
    publicUrl.addEventListener('invalid', validateUrl);
    const slow = el('input', { type: 'number', min: 1, max: 50, step: 1, value: String(line.slowResponseMs / 1000), 'aria-describedby': 'line-slow-error' });
    const slowError = el('div', { id: 'line-slow-error', class: 'notice error', role: 'alert', hidden: true });
    const slowField = field('Slow response (seconds)', slow, "Up to 50 seconds, so LINE's reply token is still valid.");
    slowField.append(slowError);
    function validateSlow(): boolean {
      const n = Number(slow.value);
      const valid = Number.isInteger(n) && n >= 1 && n <= 50;
      slowError.textContent = valid ? '' : 'Slow response must be a whole number between 1 and 50 seconds';
      slowError.hidden = valid;
      slow.setAttribute('aria-invalid', String(!valid));
      return valid;
    }
    slow.addEventListener('input', validateSlow);
    slow.addEventListener('invalid', validateSlow);
    const users = ids('Allowed users', 'U', line.allow.users);
    const groups = ids('Allowed groups', 'C', line.allow.groups);
    const rooms = ids('Allowed rooms', 'R', line.allow.rooms);
    const state = (label: string, name: string) =>
      el('div', { class: 'key-state' }, `${label}: `, secrets[name] ? el('code', {}, secrets[name]) : el('span', { class: 'muted' }, 'not set'));

    const submit = el('button', { type: 'submit', class: 'btn primary' }, 'Save');
    const form = el('form', { class: 'card' },
      el('h3', {}, 'LINE Messaging API'),
      enabled.root,
      el('div', { class: 'grid2' },
        el('div', {}, state('Channel access token', ACCESS_NAME), field('Replace token', token)),
        el('div', {}, state('Channel secret', CHANNEL_NAME), field('Replace secret', secret))),
      el('div', { class: 'grid2' },
        field('Local port', port, 'The gateway listens on 127.0.0.1 only.'),
        urlField), slowField,
      el('h3', {}, 'Who may talk to BigNose'),
      el('p', { class: 'muted' }, 'Deny by default: anyone not listed gets no reply.'),
      users.root, groups.root, rooms.root,
      el('p', { class: 'hint' }, 'Save does not prove the token or the tunnel work: use Connect and Test webhook.'),
      el('div', { class: 'actions' }, submit));

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const urlValid = validateUrl(), slowValid = validateSlow();
      if (!urlValid || !slowValid) return;
      const slowResponseMs = Number(slow.value) * 1000;
      void guarded(async () => {
        const p = Number(port.value);
        if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error('Port must be between 1 and 65535');
        const pub = publicUrl.value.trim();
        const allow = { users: users.value(), groups: groups.value(), rooms: rooms.value() };
        if (token.value.trim()) await api.putSecret(ACCESS_NAME, token.value.trim());
        if (secret.value.trim()) await api.putSecret(CHANNEL_NAME, secret.value.trim());
        await api.updateSettings((c) => {
          c.line.enabled = enabled.input.checked;
          c.line.port = p;
          c.line.slowResponseMs = slowResponseMs;
          if (pub) c.line.publicUrl = pub; else delete c.line.publicUrl;
          c.line.allow = allow;
        });
        toast('Saved');
        reload();
      }, submit);
    });

    pane.append(el('h2', {}, 'Messaging'), el('p', { class: 'muted' }, 'Talk to BigNose from LINE. Only LINE is supported.'), status, form);
  }

  reload();
}
