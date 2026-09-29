import { readFile } from "node:fs/promises";
import { parse } from "yaml";

export interface AgentDefinition {
  /** Comma-separated tool list from frontmatter, if any. */
  tools?: string;
  body: string;
}

export function parseAgentMarkdown(markdown: string): AgentDefinition {
  if (!markdown.startsWith("---\n")) return { body: markdown };
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) return { body: markdown };
  const meta = parse(markdown.slice(4, end)) as { tools?: unknown } | null;
  const tools = typeof meta?.tools === "string" ? meta.tools : undefined;
  return { tools, body: markdown.slice(end + 5) };
}

export async function loadAgent(path: string): Promise<AgentDefinition> {
  return parseAgentMarkdown(await readFile(path, "utf8"));
}
