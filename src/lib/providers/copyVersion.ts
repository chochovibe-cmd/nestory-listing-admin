/** Bump when evidence selection, prompts, postprocessing or model review changes. */
export const COPY_PIPELINE_VERSION = "chaochao-evidence-v2-20260925";
export function copyRuntimeVersion(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "local";
  return `${COPY_PIPELINE_VERSION}@${sha}`;
}
