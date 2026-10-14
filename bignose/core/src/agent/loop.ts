import type { Provider, Message, Tool, Policy, HooksConfig, Approver, Origin, AgentEvent, RunStatus, StopReason, Usage, ToolUseBlock, ToolResult, ContentBlock } from '../types.ts';
import { randomUUID } from 'node:crypto';
import { effectivePolicy, checkPermission } from './permissions.ts';
import { runHooks } from './hooks.ts';
import { withAbort } from './abort.ts';
import { budgetResult, isContextOverflow, pruneResults, resultCap, safeName } from './budget.ts';
import { coerceArgs } from '../tools/coerce.ts';
export interface RunOptions { provider: Provider; model: string; system: string; context: Message[]; input: string; tools: Tool[]; maxTurns: number; maxTokens: number; contextWindow: number; compactAt: number; permissions: Record<string, Policy>; hooks: HooksConfig; approve?: Approver; sessionId: string; origin: Origin; cwd: string; signal: AbortSignal; onEvent?: (event: AgentEvent) => void; depth?: number;
  onMessage?: (message: Message) => void /* each finished step (assistant message, tool results) as it is added; not the input */;
  spillDir?: string; redact?: (text: string) => string /* tool output over the per-result budget is saved to a file in spillDir (redacted) */ }
export interface RunResult { context: Message[]; added: Message[]; status: RunStatus; text: string; usage: Usage; error?: string; warning?: string }
export async function runAgent(opts: RunOptions): Promise<RunResult> {
  let context = structuredClone(opts.context);
  // Every text is redacted before it is cut anywhere in the loop (history, preview, prune head, tool names).
  const clean = opts.redact ?? ((s: string) => s);
  // A model-made name is redacted before safeName cuts it at 64, or a cut prefix of a secret would no longer match.
  const nameOf = (name: string) => safeName(clean(name));
  // Sessions stored before names were checked may hold a name the provider rejects; fix it so the session works again.
  for (const m of context) for (const b of m.content) if (b.type === 'tool_use') b.name = nameOf(b.name);
  const added: Message[] = [], usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let status: RunStatus = 'max_turns', text = '', error: string | undefined, turns = 0, lastInput = 0, lastStop: StopReason | undefined;
  const depth = opts.depth ?? 0;
  const emit = (event: AgentEvent) => opts.onEvent?.(event);
  const append = (message: Message, step = true) => { context.push(message); added.push(message); if (step) opts.onMessage?.(message); };
  append({ role: 'user', content: [{ type: 'text', text: opts.input }] }, false);
  // Everything the provider counts: system prompt, tool schemas and messages, with room kept for the reply (at most half the window).
  const fixed = (opts.system.length + JSON.stringify(opts.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))).length) / 4;
  const size = () => Math.max(lastInput, JSON.stringify(context).length / 4 + fixed);
  const limit = Math.max(opts.contextWindow - opts.maxTokens, opts.contextWindow / 2) * opts.compactAt;
  const cap = resultCap(opts.contextWindow);
  let force = false, overflows = 0;
  const baseRequest = () => ({ model: opts.model, system: opts.system, messages: context, tools: opts.tools, maxTokens: opts.maxTokens, signal: opts.signal });
  try {
    while (turns < opts.maxTurns) {
      opts.signal.throwIfAborted();
      if (force || size() > limit) {
        let cut = Math.max(0, context.length - 4);
        const tailResults = new Set(context.slice(cut).flatMap(m => m.content.flatMap(b => b.type === 'tool_result' ? [b.toolUseId] : [])));
        for (let i = 0; i < cut; i++) if (context[i]!.content.some(b => b.type === 'tool_use' && tailResults.has(b.id))) cut = i;
        if (cut === 1 && context[0]?.content.some(b => b.type === 'text' && b.text.startsWith('[Summary of earlier conversation]\n'))) cut = 0;
        if (cut > 0) {
          const history = context.slice(0, cut).flatMap(m => m.content.map(b => {
            if (b.type === 'text') return `${m.role}: ${clean(b.text)}`;
            if (b.type === 'tool_use') return `assistant called ${b.name}(${clean(JSON.stringify(b.input)).slice(0, 1000)}) [${b.id}]`;
            return `tool result [${b.toolUseId}]${b.isError ? ' (error)' : ''}: ${clean(b.content).slice(0, 2000)}`;
          })).join('\n');
          const summarise = async (text: string) => {
            let out = '';
            const iterator = opts.provider.stream({ ...baseRequest(), system: 'Summarise the conversation for continuation. Preserve decisions, facts, tool findings and unfinished work.', messages: [{ role: 'user', content: [{ type: 'text', text }] }], tools: [] })[Symbol.asyncIterator]();
            try {
              while (true) {
                const next = await withAbort(iterator.next(), opts.signal);
                if (next.done) break;
                if (next.value.type === 'text_delta') out += next.value.text;
                if (next.value.type === 'done') { usage.inputTokens += next.value.usage.inputTokens; usage.outputTokens += next.value.usage.outputTokens; }
              }
            } finally { void iterator.return?.().catch(() => {}); }
            return out;
          };
          // The summary request must fit too: keep only the newest part of the history (half as much after an overflow), and if the
          // provider still refuses it, quarter the history and ask again within the same two-overflow budget. At least 8000 characters.
          let keep = Math.max(limit * 4, 8000) / (force ? 2 : 1), summary = '';
          turns++;
          for (;;) {
            try { summary = await summarise(history.slice(-keep)); break; }
            catch (e) { if (!isContextOverflow(e) || overflows++ >= 2) throw e; keep /= 4; }
          }
          if (!summary.trim()) throw new Error('Compaction returned an empty summary');
          context = [{ role: 'user', content: [{ type: 'text', text: `[Summary of earlier conversation]\n${summary}` }] }, ...context.slice(cut)];
          lastInput = 0;
          emit({ type: 'compaction', removedMessages: cut });
          if (turns >= opts.maxTurns) break;
        }
        // Recent tool output the summary cannot touch: shrink the oldest large results until the request fits.
        const excess = (force ? size() / 2 : size() - limit) * 4;
        if (excess > 0) { context = pruneResults(context, excess, clean); lastInput = 0; }
        force = false;
      }
      const content: ContentBlock[] = [], calls = new Map<string, ToolUseBlock>(), complete = new Set<string>(), invalid = new Map<string, string>();
      let streamError: unknown;
      text = ''; lastStop = undefined;
      const iterator = opts.provider.stream(baseRequest())[Symbol.asyncIterator]();
      turns++;
      try {
        while (true) {
          const next = await withAbort(iterator.next(), opts.signal);
          if (next.done) break;
          const e = next.value;
          if (e.type === 'text_delta') {
            text += e.text;
            const last = content.at(-1);
            if (last?.type === 'text') last.text += e.text; else content.push({ type: 'text', text: e.text });
            emit(e);
          } else if (e.type === 'tool_call_start' || e.type === 'tool_call') {
            let call = calls.get(e.id);
            if (!call) { call = { type: 'tool_use', id: e.id, name: e.name, input: {} }; calls.set(e.id, call); content.push(call); }
            if (e.type === 'tool_call') { call.name = e.name; call.input = e.input; complete.add(e.id); if (e.error) invalid.set(e.id, e.error); }
          } else if (e.type === 'done') {
            lastInput = e.usage.inputTokens; lastStop = e.stopReason;
            usage.inputTokens += e.usage.inputTokens; usage.outputTokens += e.usage.outputTokens;
          }
        }
      } catch (e) { streamError = e; }
      finally { void iterator.return?.().catch(() => {}); }
      // The provider refused the request as too large before answering anything: compact (and prune) harder and ask again, twice at most.
      if (streamError && !content.length && isContextOverflow(streamError) && overflows++ < 2) { force = true; turns--; continue; }
      const orderedCalls = [...complete].map(id => calls.get(id)!).concat([...calls.values()].filter(call => !complete.has(call.id)));
      let callIndex = 0;
      if (content.length) append({ role: 'assistant', content: content.map(b => {
        if (b.type !== 'tool_use') return b;
        const call = orderedCalls[callIndex++]!;
        return { ...call, name: nameOf(call.name) };
      }) });
      const replies: ContentBlock[] = [];
      for (const call of orderedCalls) {
        emit({ type: 'tool_start', callId: call.id, name: clean(call.name), input: call.input });
        let result: ToolResult, input = call.input;
        try {
          opts.signal.throwIfAborted();
          if (streamError) throw streamError;
          if (!complete.has(call.id)) throw new Error('Incomplete tool arguments');
          if (invalid.has(call.id)) throw new Error(invalid.get(call.id));
          const tool = opts.tools.find(t => t.name === call.name);
          if (!tool) throw new Error(`Unknown tool: ${clean(call.name).slice(0, 100)}`);
          input = coerceArgs(call.input, tool.inputSchema); // once, so approval, hooks and the tool all see the same arguments
          const policy = effectivePolicy(tool, opts.permissions);
          const req = { id: randomUUID(), sessionId: opts.sessionId, origin: opts.origin, tool: call.name, input };
          let denied: ToolResult | undefined;
          if (policy === 'ask') {
            let allowed = false;
            emit({ type: 'approval_request', approvalId: req.id, tool: call.name, input });
            try { denied = await withAbort(checkPermission(policy, req, opts.approve), opts.signal); allowed = denied === undefined; }
            finally { emit({ type: 'approval_result', approvalId: req.id, allowed: !opts.signal.aborted && allowed }); }
          } else denied = await checkPermission(policy, req, opts.approve);
          const blocked = denied ?? await runHooks(opts.hooks.preTool, { event: 'preTool', sessionId: opts.sessionId, tool: call.name, input }, opts.signal);
          opts.signal.throwIfAborted();
          result = blocked ?? await withAbort(tool.run(input, {
            sessionId: opts.sessionId, origin: opts.origin, cwd: opts.cwd, signal: opts.signal, depth,
            ...(depth < 1 ? { delegate: async (task: string) => {
              const nested = await runAgent({ ...opts, context: [], input: task, tools: opts.tools.filter(t => t.name !== 'delegate'), depth: depth + 1, onEvent: undefined, onMessage: undefined });
              if (nested.status !== 'done') throw new Error(nested.error ?? `Delegate stopped: ${nested.status}`);
              return nested.text;
            } } : {}),
          }), opts.signal);
        } catch (e) { result = { content: opts.signal.aborted ? 'interrupted' : e instanceof Error ? e.message : String(e), isError: true }; }
        const output = await budgetResult(result.content, cap, opts.spillDir, opts.redact);
        replies.push({ type: 'tool_result', toolUseId: call.id, content: output, isError: result.isError ?? false });
        emit({ type: 'tool_end', callId: call.id, name: clean(call.name), isError: result.isError ?? false, output: output.slice(0, 2000) });
        await runHooks(opts.hooks.postTool, { event: 'postTool', sessionId: opts.sessionId, tool: call.name, input, output, isError: result.isError ?? false });
      }
      if (replies.length) append({ role: 'user', content: replies });
      opts.signal.throwIfAborted();
      if (streamError) throw streamError;
      if (!calls.size) { status = 'done'; break; }
    }
  } catch (e) {
    status = opts.signal.aborted ? 'interrupted' : 'error';
    if (status === 'error') error = e instanceof Error ? e.message : String(e);
  }
  // A finished run can still have failed the user: a reply cut at the output limit, or none at all.
  const warning = status !== 'done' ? undefined : lastStop === 'max_tokens'
    ? 'The reply was cut off at the output limit (max_tokens). Send another message to continue, or raise the limit in the agent settings.'
    : !text.trim() ? 'The model returned an empty reply.' : undefined;
  if (depth === 0) await runHooks(opts.hooks.sessionEnd, { event: 'sessionEnd', sessionId: opts.sessionId, status });
  emit({ type: 'run_end', status, text, ...(error ? { error } : {}), ...(warning ? { warning } : {}) });
  return { context, added, status, text, usage, ...(error ? { error } : {}), ...(warning ? { warning } : {}) };
}
