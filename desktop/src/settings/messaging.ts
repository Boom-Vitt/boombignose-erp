// Settings: Messaging (LINE only).
import type { Api } from '../api.ts';
import type { LineStatus, Settings } from '../types.ts';
import { badge, btn, check, el, field, formatTime, guarded, load, toast } from '../dom.ts';

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
    const webhook = st.webhookUrl || (line.publicUrl ? `${line.publicUrl.replace(/\/+$/, '')}/line/webhook` : '');

    const status = el('section', { class: 'card' },
      el('h3', {}, 'Status', badge(st.enabled ? 'Enabled' : 'Disabled', st.enabled ? 'ok' : ''), badge(st.running ? 'Running' : 'Stopped', st.running ? 'ok' : 'warn')),
      el('div', { class: 'badges' }, badge(st.tokenSet ? 'Access token set' : 'Access token missing', st.tokenSet ? 'ok' : 'bad'), badge(st.secretSet ? 'Channel secret set' : 'Channel secret missing', st.secretSet ? 'ok' : 'bad')),
      el('div', { class: 'field' }, el('label', {}, el('span', { class: 'field-label' }, 'Webhook URL'), el('input', { type: 'text', readonly: true, value: webhook, placeholder: 'Set a public URL below' })),
        webhook && btn('Copy', (b) => void guarded(async () => { await navigator.clipboard.writeText(webhook); toast('Copied'); }, b), 'small')),
      st.lastEventAt && el('p', { class: 'muted' }, `Last event: ${formatTime(st.lastEventAt)}`),
      st.lastError && el('p', { class: 'notice error' }, st.lastError),
      el('div', { class: 'actions' }, btn('Refresh', reload)));

    const enabled = check('Enable the LINE gateway', line.enabled);
    const token = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Paste to replace' });
    const secret = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Paste to replace' });
    const port = el('input', { type: 'number', min: 1, max: 65535, value: line.port });
    const publicUrl = el('input', { type: 'url', value: line.publicUrl ?? '', placeholder: 'https://your-tunnel.example.com', autocomplete: 'off', spellcheck: 'false' });
    const users = ids('Allowed users', 'U', line.allow.users);
    const groups = ids('Allowed groups', 'C', line.allow.groups);
    const rooms = ids('Allowed rooms', 'R', line.allow.rooms);
    const state = (label: string, name: string) =>
      el('div', { class: 'key-state' }, `${label}: `, secrets[name] ? el('code', {}, secrets[name]) : el('span', { class: 'muted' }, 'not set'));

    const form = el('form', { class: 'card' },
      el('h3', {}, 'LINE Messaging API'),
      enabled.root,
      el('div', { class: 'grid2' },
        el('div', {}, state('Channel access token', ACCESS_NAME), field('Replace token', token)),
        el('div', {}, state('Channel secret', CHANNEL_NAME), field('Replace secret', secret))),
      el('div', { class: 'grid2' },
        field('Local port', port, 'The gateway listens on 127.0.0.1 only.'),
        field('Public URL', publicUrl, 'A public HTTPS address (for example a tunnel) that forwards to the local port. LINE calls <URL>/line/webhook.')),
      el('h3', {}, 'Who may talk to BigNose'),
      el('p', { class: 'muted' }, 'Deny by default: anyone not listed gets no reply.'),
      users.root, groups.root, rooms.root,
      el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'btn primary' }, 'Save')));

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      void guarded(async () => {
        const p = Number(port.value);
        if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error('Port must be between 1 and 65535');
        const pub = publicUrl.value.trim();
        if (pub) {
          let u: URL;
          try { u = new URL(pub); } catch { throw new Error('Public URL is not a valid URL'); }
          if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Public URL must start with https://');
        }
        const allow = { users: users.value(), groups: groups.value(), rooms: rooms.value() };
        if (token.value.trim()) await api.putSecret(ACCESS_NAME, token.value.trim());
        if (secret.value.trim()) await api.putSecret(CHANNEL_NAME, secret.value.trim());
        await api.updateSettings((c) => {
          c.line.enabled = enabled.input.checked;
          c.line.port = p;
          if (pub) c.line.publicUrl = pub; else delete c.line.publicUrl;
          c.line.allow = allow;
        });
        toast('Saved');
        reload();
      }, form.querySelector('button[type=submit]') as HTMLButtonElement);
    });

    pane.append(el('h2', {}, 'Messaging'), el('p', { class: 'muted' }, 'Talk to BigNose from LINE. Only LINE is supported.'), status, form);
  }

  reload();
}
