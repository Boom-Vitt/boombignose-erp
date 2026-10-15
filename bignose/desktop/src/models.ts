import type { Api } from './api.ts';
import type { ModelInfo } from './types.ts';
import { el, errMsg, field } from './dom.ts';

/** A model text field with a datalist of the provider's models. `onList` gets the same list (empty while loading or when it fails). `reload` asks again after the provider's value was set by code. */
export function modelField(api: Api, provider: HTMLSelectElement, model: HTMLInputElement, id: string, label = 'Model', onList?: (models: ModelInfo[]) => void): HTMLElement & { reload(): Promise<void> } {
  model.setAttribute('list', id);
  const models = el('datalist', { id });
  const error = el('div', { class: 'muted hint', role: 'status', hidden: true });
  const root = Object.assign(field(label, model), { reload: () => reload() });
  root.append(models, error);
  let sequence = 0;
  async function reload(): Promise<void> {
    const seq = ++sequence;
    models.replaceChildren(); error.hidden = true; onList?.([]);
    try {
      const result = await api.listModels(provider.value);
      if (seq !== sequence) return;
      if (!result.ok) throw new Error(result.error || 'Model list unavailable');
      models.replaceChildren(...result.models.map(m => el('option', { value: m.id }, m.label ?? m.id)));
      onList?.(result.models);
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
