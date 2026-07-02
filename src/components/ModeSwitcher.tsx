"use client";

import { useEffect, useState } from "react";

export const RUN_MODE_STORAGE_KEY = "nestory_run_mode";

export type RunMode = "test" | "llm";

export function readStoredRunMode(): RunMode {
  if (typeof window === "undefined") return "llm";
  return window.localStorage.getItem(RUN_MODE_STORAGE_KEY) === "test" ? "test" : "llm";
}

export function ModeSwitcher() {
  const [mode, setMode] = useState<RunMode>("llm");

  useEffect(() => {
    setMode(readStoredRunMode());
  }, []);

  function choose(next: RunMode) {
    setMode(next);
    window.localStorage.setItem(RUN_MODE_STORAGE_KEY, next);
  }

  return (
    <div className="pill-group mode-pill" aria-label="生成模式">
      <button
        className={`pill-btn${mode === "test" ? " active" : ""}`}
        onClick={() => choose("test")}
        title="測試模式：不呼叫 AI、零成本跑流程（tags 仍為正式結果）"
        type="button"
      >
        測試
      </button>
      <button
        className={`pill-btn${mode === "llm" ? " active" : ""}`}
        onClick={() => choose("llm")}
        title="LLM 模式：呼叫 AI 生成完整潤稿文案"
        type="button"
      >
        LLM
      </button>
    </div>
  );
}
