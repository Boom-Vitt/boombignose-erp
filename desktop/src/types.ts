// Shapes the UI exchanges with the local API (docs/design.md sections 3 and 6). Kept local on purpose:
// the UI is compiled on its own into dist/, so it cannot import from core/.

export type TextBlock = { type: 'text'; text: string };
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
export type ToolResultBlock = { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
export type Message = { role: 'user' | 'assistant'; content: ContentBlock[] };

export type ProviderKind = 'anthropic' | 'openai-compatible';
export type Policy = 'allow' | 'ask' | 'deny';
export interface ProviderConfig {
  id: string; kind: ProviderKind; label?: string; baseUrl: string;
  apiKeyEnv?: string; contextWindow?: number; maxTokens?: number;
}
export type McpServerConfig =
  | { transport: 'stdio'; command: string; args?: string[]; env?: Record<string, string>; enabled: boolean; tools?: string[] }
  | { transport: 'http'; url: string; headers?: Record<string, string>; enabled: boolean; tools?: string[] };
export interface LineConfig {
  enabled: boolean; port: number; publicUrl?: string; slowResponseMs: number;
  allow: { users: string[]; groups: string[]; rooms: string[] };
}
// The UI only edits the parts it shows and sends everything else back unchanged.
export interface Config {
  version: 1;
  active: { provider: string; model: string };
  providers: ProviderConfig[];
  agent: { maxTurns: number; workspace: string; compactAt: number; systemPrompt?: string };
  permissions: Record<string, Policy>;
  hooks: Record<string, unknown>;
  mcp: { servers: Record<string, McpServerConfig> };
  line: LineConfig;
  api: { port: number };
}

// ---- events from GET /api/events
type Tag = { sessionId: string; runId: string };
export type RunStatus = 'done' | 'interrupted' | 'max_turns' | 'error';
export type ApiEvent =
  | ({ type: 'run_start' } & Tag)
  | ({ type: 'text_delta'; text: string } & Tag)
  | ({ type: 'tool_start'; callId: string; name: string; input: Record<string, unknown> } & Tag)
  | ({ type: 'tool_end'; callId: string; name: string; isError: boolean; output: string } & Tag)
  | ({ type: 'approval_request'; approvalId: string; tool: string; input: Record<string, unknown> } & Tag)
  | ({ type: 'approval_result'; approvalId: string; allowed: boolean } & Tag)
  | ({ type: 'compaction'; removedMessages: number } & Tag)
  | ({ type: 'run_end'; status: RunStatus; text: string; error?: string } & Tag)
  | { type: 'session_updated'; sessionId: string }
  | { type: 'notification'; title: string; body: string; sessionId?: string };

// ---- responses
export type Time = number | string; // epoch ms/s or ISO text: the contract does not say, so accept both
export interface Health { ok: true; version: string; pid: number }
export interface Status {
  version: string;
  provider: { id: string; kind: string; model: string };
  line: { enabled: boolean; running: boolean; webhookUrl?: string };
  mcp: { name: string; enabled: boolean; connected: boolean; tools: number }[];
  schedules: number;
}
export interface SessionSummary { id: string; title: string; updatedAt: Time; snippet?: string }
export interface SessionDetail { id: string; title: string; messages: Message[] }
export interface Settings { config: Config; secrets: Record<string, string> }
export interface McpServerInfo {
  name: string; transport: 'stdio' | 'http'; enabled: boolean; connected: boolean; error?: string;
  tools?: { name: string; selected: boolean }[];
}
export interface McpToolInfo { name: string; description?: string; selected: boolean }
export interface TestResult { ok: boolean; tools: number; error?: string }
export interface SkillSummary { name: string; description: string }
export interface Skill extends SkillSummary { body: string }
export type MemoryKind = 'user' | 'agent';
export interface MemoryNote { id: string | number; kind: MemoryKind; text: string; updatedAt: Time }
export type Delivery = { kind: 'desktop' } | { kind: 'line'; to: string };
export interface Job {
  id: string; cron: string; prompt: string; delivery: Delivery; enabled: boolean;
  nextRunAt?: Time | null; lastRunAt?: Time | null; lastStatus?: string | null;
}
export interface LineStatus {
  enabled: boolean; running: boolean; port: number; publicUrl?: string; webhookUrl?: string;
  tokenSet: boolean; secretSet: boolean; lastEventAt?: Time; lastError?: string;
}
