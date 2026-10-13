import type { ApprovalRequest, Approver, Policy, Tool, ToolResult } from '../types.ts';
export function effectivePolicy(tool: Tool, permissions: Record<string, Policy>): Policy {
  if (Object.hasOwn(permissions, tool.name)) return permissions[tool.name]!;
  const prefix = Object.keys(permissions).filter(k => k.endsWith('*') && tool.name.startsWith(k.slice(0, -1))).sort((a, b) => b.length - a.length)[0];
  return prefix ? permissions[prefix]! : tool.defaultPolicy;
}
export async function checkPermission(policy: Policy, req: ApprovalRequest, approve?: Approver): Promise<ToolResult | undefined> {
  if (policy === 'deny') return { content: 'denied by policy', isError: true };
  if (policy === 'ask' && (!approve || !(await approve(req)))) return { content: 'denied by user', isError: true };
  return undefined;
}
