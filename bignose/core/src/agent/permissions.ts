import type { ApprovalRequest, Approver, Policy, Tool, ToolResult } from '../types.ts';
/** The first layer that has a rule for the tool decides, as a whole: inside a layer its exact name, then its longest `prefix*` rule. No layer has one: the tool's default. */
export function layeredPolicy(tool: Tool, ...layers: Record<string, Policy>[]): Policy {
  for (const permissions of layers) {
    const key = Object.hasOwn(permissions, tool.name) ? tool.name
      : Object.keys(permissions).filter(k => k.endsWith('*') && tool.name.startsWith(k.slice(0, -1))).sort((a, b) => b.length - a.length)[0];
    if (key !== undefined) return permissions[key]!;
  }
  return tool.defaultPolicy;
}
export const effectivePolicy = (tool: Tool, permissions: Record<string, Policy>): Policy => layeredPolicy(tool, permissions);
export async function checkPermission(policy: Policy, req: ApprovalRequest, approve?: Approver): Promise<ToolResult | undefined> {
  if (policy === 'deny') return { content: 'denied by policy', isError: true };
  if (policy !== 'allow' && policy !== 'ask') return { content: 'invalid policy', isError: true };
  if (policy === 'ask' && (!approve || !(await approve(req)))) return { content: 'denied by user', isError: true };
  return undefined;
}
