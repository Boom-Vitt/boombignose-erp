import type { Api } from './api.ts';
import { el, errMsg, field } from './dom.ts';

export function modelField(api: Api, provider: HTMLSelectElement, model: HTMLInputElement, id: string): HTMLElement {
  model.setAttribute('list', id);
  const models = el('datalist', { id });
  const error = el('div', { class: 'muted hint', role: 'status', hidden: true });
  const root = field('Model', model);
  root.append(models, error);
  let sequence = 0;
  async function reload(): Promise<void> {
    const seq = ++sequence;
    models.replaceChildren(); error.hidden = true;
    try {
      const result = await api.listModels(provider.value);
      if (seq !== sequence) return;
      if (!result.ok) throw new Error(result.error || 'Model list unavailable');
      models.replaceChildren(...result.models.map(m => el('option', { value: m.id }, m.label ?? m.id)));
    } catch (e) {
      if (seq !== sequence) return;
      error.textContent = `Couldn't load the model list: ${errMsg(e)}. You can still type a model id.`;
      error.hidden = false;
    }
  }
  provider.addEventListener('change', () => void reload());
  void reload();
  return root;
}
