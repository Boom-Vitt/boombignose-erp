// Shared contracts for BigNose core. Erasable TypeScript only.

export type JsonSchema = { type?: string; description?: string; properties?: Record<string, JsonSchema>;
  required?: string[]; items?: JsonSchema; enum?: unknown[]; [key: string]: unknown };

// ---- conversation (provider-neutral; adapters convert to and from the wire formats)
export type TextBlock = { type: 'text'; text: string };
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
export type ToolResultBlock = { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
export type Message = { role: 'user' | 'assistant'; content: ContentBlock[] };

// ---- providers
export type ProviderKind = 'anthropic' | 'openai-compatible';
export interface ToolSpec { name: string; description: string; inputSchema: JsonSchema }
export interface ProviderRequest {
  model: string; system: string; messages: Message[]; tools: ToolSpec[]; maxTokens: number; signal?: AbortSignal;
}
export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens';
export interface Usage { inputTokens: number; outputTokens: number }
export type ProviderEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }                                  // as soon as the name is known
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }       // arguments complete
  | { type: 'done'; stopReason: StopReason; usage: Usage };
export interface Provider { readonly kind: ProviderKind; stream(req: ProviderRequest): AsyncIterable<ProviderEvent> }

// ---- tools and permissions
export type Policy = 'allow' | 'ask' | 'deny';
export interface Agent {
  id: string; name: string; icon: string; instructions: string; provider: string; model: string;
  permissions: Record<string, Policy>; connectors: string[] | null; skills: string[] | null;
  createdAt: number; updatedAt: number;
}
export type Origin = { kind: 'desktop' } | { kind: 'cli' } | { kind: 'line'; to: string } | { kind: 'cron'; jobId: string };
export type Delivery = { kind: 'desktop' } | { kind: 'line'; to: string };
export interface ToolContext {
  sessionId: string; origin: Origin; cwd: string; signal: AbortSignal; depth: number;
  delegate?: (task: string) => Promise<string>;     // set by the agent loop when depth allows
}
export interface ToolResult { content: string; isError?: boolean }
export interface Tool extends ToolSpec {
  defaultPolicy: Policy;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
export interface ApprovalRequest { id: string; sessionId: string; origin: Origin; tool: string; input: Record<string, unknown> }
export type Approver = (req: ApprovalRequest) => Promise<boolean>;

// ---- hooks
export interface HookSpec { command: string; tools?: string[]; timeoutMs?: number }
export interface HooksConfig { preTool?: HookSpec[]; postTool?: HookSpec[]; sessionEnd?: HookSpec[] }

// ---- agent events (the local API streams them with sessionId and runId added)
export type RunStatus = 'done' | 'interrupted' | 'max_turns' | 'error';
export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; callId: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_end'; callId: string; name: string; isError: boolean; output: string }   // output cut to 2000 chars
  | { type: 'approval_request'; approvalId: string; tool: string; input: Record<string, unknown> }
  | { type: 'approval_result'; approvalId: string; allowed: boolean }
  | { type: 'compaction'; removedMessages: number }
  | { type: 'run_end'; status: RunStatus; text: string; error?: string };

// ---- config (~/.bignose/config.json); secrets are never stored here
export interface ProviderConfig {
  id: string; kind: ProviderKind; label?: string; baseUrl: string;
  apiKeyEnv?: string;          // name of the .env variable holding the key; absent = no auth (local servers)
  contextWindow?: number; maxTokens?: number;
}
export type McpServerConfig =
  | { transport: 'stdio'; command: string; args?: string[]; env?: Record<string, string>; enabled: boolean; tools?: string[] }
  | { transport: 'http'; url: string; headers?: Record<string, string>; enabled: boolean; tools?: string[] };
export interface LineConfig {
  enabled: boolean; port: number; publicUrl?: string; slowResponseMs: number;
  agentId?: string;
  allow: { users: string[]; groups: string[]; rooms: string[] };
}
export interface Config {
  version: 1;
  active: { provider: string; model: string };
  providers: ProviderConfig[];
  agent: { maxTurns: number; workspace: string; compactAt: number; systemPrompt?: string };
  permissions: Record<string, Policy>;   // exact tool name, or a prefix ending in '*'; overrides Tool.defaultPolicy
  hooks: HooksConfig;
  mcp: { servers: Record<string, McpServerConfig> };
  line: LineConfig;
  api: { port: number };
}
