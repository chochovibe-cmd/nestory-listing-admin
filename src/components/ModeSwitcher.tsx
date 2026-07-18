"use client";

import { useEffect, useState } from "react";

export const RUN_MODE_STORAGE_KEY = "nestory_run_mode";

/** Same-tab bridge so generate chip / header badge update without reload. */
export const RUN_MODE_CHANGE_EVENT = "nestory:run-mode";

export type RunMode = "test" | "llm";

export function readStoredRunMode(): RunMode {
  if (typeof window === "undefined") return "llm";
  return window.localStorage.getItem(RUN_MODE_STORAGE_KEY) === "test" ? "test" : "llm";
}

function emitRunModeChange(mode: RunMode) {
  window.dispatchEvent(new CustomEvent<RunMode>(RUN_MODE_CHANGE_EVENT, { detail: mode }));
}

export function ModeSwitcher() {
  const [mode, setMode] = useState<RunMode>("llm");

  useEffect(() => {
    setMode(readStoredRunMode());

    function onCustom(event: Event) {
      const detail = (event as CustomEvent<RunMode>).detail;
      if (detail === "test" || detail === "llm") setMode(detail);
    }
    function onStorage(event: StorageEvent) {
      if (event.key !== RUN_MODE_STORAGE_KEY) return;
      setMode(event.newValue === "test" ? "test" : "llm");
    }

    window.addEventListener(RUN_MODE_CHANGE_EVENT, onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(RUN_MODE_CHANGE_EVENT, onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function choose(next: RunMode) {
    setMode(next);
    window.localStorage.setItem(RUN_MODE_STORAGE_KEY, next);
    emitRunModeChange(next);
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
