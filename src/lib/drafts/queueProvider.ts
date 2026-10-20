export type QueueProvider = "openai" | "claude";

/** Production has no Claude key: fall back to GPT instead of queueing a job that must fail. */
export function effectiveQueueProvider(requested: unknown, claudeAvailable: boolean): QueueProvider {
  return requested === "claude" && claudeAvailable ? "claude" : "openai";
}

export function hasClaudeKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}
