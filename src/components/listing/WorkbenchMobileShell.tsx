"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  GENERATION_PROGRESS_EVENT,
  type GenerationProgress
} from "@/components/listing/generationProgress";

export type WorkbenchPane = "input" | "results";

/**
 * B16: mobile workbench shell — sticky 輸入／結果 sub-tabs under 960px.
 * Desktop keeps the existing two-column grid (children always mounted).
 * D1-A: when generation progress becomes visible, auto-switch to 結果.
 */
export function WorkbenchMobileShell({
  input,
  results
}: {
  input: ReactNode;
  results: ReactNode;
}) {
  const [pane, setPane] = useState<WorkbenchPane>("input");
  const [genActive, setGenActive] = useState(false);

  useEffect(() => {
    function onProgress(event: Event) {
      const model = (event as CustomEvent<GenerationProgress>).detail;
      if (!model || !model.visible) {
        setGenActive(false);
        return;
      }
      setGenActive(true);
      // D1-A: show progress card / new result — jump to 結果 as soon as gen starts
      setPane("results");
    }
    window.addEventListener(GENERATION_PROGRESS_EVENT, onProgress);
    return () => window.removeEventListener(GENERATION_PROGRESS_EVENT, onProgress);
  }, []);

  return (
    <div className="workbench">
      <div className="sub-tabs" role="tablist" aria-label="工作檯分頁">
        <button
          aria-selected={pane === "input"}
          className={pane === "input" ? "sub-tab sel sel--fill active" : "sub-tab"}
          onClick={() => setPane("input")}
          role="tab"
          type="button"
        >
          ✦ 輸入
        </button>
        <button
          aria-selected={pane === "results"}
          className={pane === "results" ? "sub-tab sel sel--fill active" : "sub-tab"}
          onClick={() => setPane("results")}
          role="tab"
          type="button"
        >
          ◈ 結果
          {genActive ? <span className="sub-tab-dot" aria-label="生成中" /> : null}
        </button>
      </div>
      <div className="workbench-panes">
        <div
          className={`workbench-pane workbench-pane-input${pane === "input" ? " mob-active" : ""}`}
          id="paneForm"
        >
          {input}
        </div>
        <div
          className={`workbench-pane workbench-pane-results${pane === "results" ? " mob-active" : ""}`}
          id="paneResults"
        >
          {results}
        </div>
      </div>
    </div>
  );
}
