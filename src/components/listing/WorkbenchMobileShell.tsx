"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  GENERATION_PROGRESS_EVENT,
  type GenerationProgress
} from "@/components/listing/generationProgress";
import { JUMP_TO_DRAFT_EVENT, type JumpToDraftDetail } from "@/lib/drafts/jumpToDraft";
import { workbenchPaneFromSearch } from "@/lib/nav";

export type WorkbenchPane = "input" | "results";

/**
 * B16: mobile workbench shell — sticky 輸入／結果 sub-tabs under 960px.
 * Desktop keeps the existing two-column grid (children always mounted).
 * D1-A / R4 Q8-A: when generation progress becomes visible, auto-switch to 結果.
 * R4: ?pane=results deep link (審核 tab) + 頂部「＋ 繼續新增」.
 */
export function WorkbenchMobileShell({
  input,
  results
}: {
  input: ReactNode;
  results: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlPane = workbenchPaneFromSearch(
    searchParams?.toString() ? `?${searchParams.toString()}` : ""
  );
  const [pane, setPane] = useState<WorkbenchPane>(urlPane);
  const [genActive, setGenActive] = useState(false);

  const setPaneAndUrl = useCallback(
    (next: WorkbenchPane, replace = true) => {
      setPane(next);
      if (pathname !== "/drafts/new") return;
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (next === "results") {
        params.set("pane", "results");
      } else {
        params.delete("pane");
      }
      const qs = params.toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  // Sync from URL (tab bar 審核 / 新增, deep links)
  useEffect(() => {
    setPane(urlPane);
  }, [urlPane]);

  useEffect(() => {
    function onProgress(event: Event) {
      const model = (event as CustomEvent<GenerationProgress>).detail;
      if (!model || !model.visible) {
        setGenActive(false);
        return;
      }
      setGenActive(true);
      // Q8-A: jump to results as soon as gen starts (D1-A)
      setPaneAndUrl("results");
    }
    window.addEventListener(GENERATION_PROGRESS_EVENT, onProgress);
    return () => window.removeEventListener(GENERATION_PROGRESS_EVENT, onProgress);
  }, [setPaneAndUrl]);

  // R4 jump strip / jump event → results pane
  useEffect(() => {
    function onJump(event: Event) {
      const detail = (event as CustomEvent<JumpToDraftDetail>).detail;
      if (!detail?.draftId) return;
      setPaneAndUrl("results");
    }
    window.addEventListener(JUMP_TO_DRAFT_EVENT, onJump);
    return () => window.removeEventListener(JUMP_TO_DRAFT_EVENT, onJump);
  }, [setPaneAndUrl]);

  return (
    <div className="workbench">
      <div className="sub-tabs" role="tablist" aria-label="工作檯分頁">
        <button
          aria-selected={pane === "input"}
          className={pane === "input" ? "sub-tab sel sel--fill active" : "sub-tab"}
          onClick={() => setPaneAndUrl("input")}
          role="tab"
          type="button"
        >
          ✦ 輸入
        </button>
        <button
          aria-selected={pane === "results"}
          className={pane === "results" ? "sub-tab sel sel--fill active" : "sub-tab"}
          onClick={() => setPaneAndUrl("results")}
          role="tab"
          type="button"
        >
          ◈ 結果
          {genActive ? <span className="sub-tab-dot" aria-label="生成中" /> : null}
        </button>
      </div>
      {pane === "results" ? (
        <div className="wb-continue-bar">
          <Link
            className="button primary wb-continue-btn"
            href="/drafts/new"
            onClick={(e) => {
              e.preventDefault();
              setPaneAndUrl("input");
            }}
          >
            ＋ 繼續新增
          </Link>
        </div>
      ) : null}
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
