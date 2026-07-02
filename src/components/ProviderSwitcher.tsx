"use client";

import { useEffect, useState } from "react";

export const AI_PROVIDER_STORAGE_KEY = "nestory_ai_provider";

export function readStoredAiProvider(): "openai" | "claude" {
  if (typeof window === "undefined") return "openai";
  return window.localStorage.getItem(AI_PROVIDER_STORAGE_KEY) === "claude" ? "claude" : "openai";
}

export function ProviderSwitcher() {
  const [provider, setProvider] = useState<"openai" | "claude">("openai");

  useEffect(() => {
    setProvider(readStoredAiProvider());
  }, []);

  function choose(next: "openai" | "claude") {
    setProvider(next);
    window.localStorage.setItem(AI_PROVIDER_STORAGE_KEY, next);
  }

  return (
    <div className="pill-group" aria-label="AI provider">
      <button
        className={`pill-btn${provider === "claude" ? " active" : ""}`}
        onClick={() => choose("claude")}
        type="button"
      >
        Claude
      </button>
      <button
        className={`pill-btn${provider === "openai" ? " active" : ""}`}
        onClick={() => choose("openai")}
        type="button"
      >
        GPT
      </button>
    </div>
  );
}
