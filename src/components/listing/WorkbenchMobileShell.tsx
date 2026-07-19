"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  GENERATION_PROGRESS_EVENT,
  type GenerationProgress
} from "@/components/listing/generationProgress";
import { JUMP_TO_DRAFT_EVENT, type JumpToDraftDetail } from "@/lib/drafts/jumpToDraft";
import { workbenchPaneFromSearch } from "@/lib/nav";

export type WorkbenchPane = "input" | "results";
/** Mobile-only sub-tab when pane=input (新增 tab). */
export type InputSubTab = "form" | "preview";

/** UX-X T93: tab index order — form → preview → results (left→right). */
function tabIndex(pane: WorkbenchPane, inputSub: InputSubTab): number {
  if (pane === "results") return 2;
  return inputSub === "form" ? 0 : 1;
}

/**
 * B16 + UX-B T4/T5:
 * - Desktop: left stack A 輸入 + B 快速預覽；right C 結果
 * - Mobile 新增 (?pane absent): sub-tabs 輸入｜快速預覽
 * - Mobile 審核 (?pane=results): results only — no 輸入｜結果 sub-tabs
 * Generation / jump → pane=results (審核).
 */
export function WorkbenchMobileShell({
  input,
  quickPreview,
  results
}: {
  input: ReactNode;
  quickPreview: ReactNode;
  results: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlPane = workbenchPaneFromSearch(
    searchParams?.toString() ? `?${searchParams.toString()}` : ""
  );
  const [pane, setPane] = useState<WorkbenchPane>(urlPane);
  const [inputSub, setInputSub] = useState<InputSubTab>("form");
  const [genActive, setGenActive] = useState(false);
  /** UX-X T93: slide direction class on the entering pane/slot (mobile only CSS). */
  const [tabAnimClass, setTabAnimClass] = useState("");
  const prevTabRef = useRef(tabIndex(urlPane, "form"));
  const animTimerRef = useRef<number | null>(null);

  const setPaneAndUrl = useCallback(
    (next: WorkbenchPane, replace = true) => {
      setPane(next);
      if (next === "input") setInputSub("form");
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
    if (urlPane === "input") setInputSub("form");
  }, [urlPane]);

  // UX-X T93: left→right tab = slide-in-right; right→left = slide-in-left
  useEffect(() => {
    const next = tabIndex(pane, inputSub);
    const prev = prevTabRef.current;
    if (next === prev) return;
    prevTabRef.current = next;
    const cls =
      next > prev
        ? "workbench-mobile-tab-enter"
        : "workbench-mobile-tab-enter-reverse";
    setTabAnimClass(cls);
    if (animTimerRef.current != null) window.clearTimeout(animTimerRef.current);
    animTimerRef.current = window.setTimeout(() => {
      setTabAnimClass("");
      animTimerRef.current = null;
    }, 220);
    return () => {
      if (animTimerRef.current != null) {
        window.clearTimeout(animTimerRef.current);
        animTimerRef.current = null;
      }
    };
  }, [pane, inputSub]);

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

  // R4 jump strip / jump event → results pane (審核)
  useEffect(() => {
    function onJump(event: Event) {
      const detail = (event as CustomEvent<JumpToDraftDetail>).detail;
      if (!detail?.draftId) return;
      setPaneAndUrl("results");
    }
    window.addEventListener(JUMP_TO_DRAFT_EVENT, onJump);
    return () => window.removeEventListener(JUMP_TO_DRAFT_EVENT, onJump);
  }, [setPaneAndUrl]);

  const formActive = pane === "input" && inputSub === "form";
  const previewActive = pane === "input" && inputSub === "preview";
  const resultsActive = pane === "results";

  return (
    <div className="workbench">
      {/* T4: only on 新增 (pane=input) — 輸入｜快速預覽. Hidden on 審核. */}
      {pane === "input" ? (
        <div className="sub-tabs sub-tabs--input" role="tablist" aria-label="新增分頁">
          <button
            aria-selected={inputSub === "form"}
            className={inputSub === "form" ? "sub-tab sel sel--fill active" : "sub-tab"}
            onClick={() => setInputSub("form")}
            role="tab"
            type="button"
          >
            ✦ 輸入
          </button>
          <button
            aria-selected={inputSub === "preview"}
            className={inputSub === "preview" ? "sub-tab sel sel--fill active" : "sub-tab"}
            onClick={() => setInputSub("preview")}
            role="tab"
            type="button"
          >
            ◈ 快速預覽
            {genActive ? <span className="sub-tab-dot" aria-label="生成中" /> : null}
          </button>
        </div>
      ) : null}

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

      <div className="workbench-panes workbench-mobile-body">
        <div
          className={`workbench-pane workbench-pane-input${pane === "input" ? " mob-active" : ""}`}
          id="paneForm"
        >
          <div
            className={`wb-form-slot${formActive ? " mob-sub-active" : ""}${
              formActive && tabAnimClass ? ` ${tabAnimClass}` : ""
            }`}
          >
            {input}
          </div>
          <div
            className={`wb-preview-slot${previewActive ? " mob-sub-active" : ""}${
              previewActive && tabAnimClass ? ` ${tabAnimClass}` : ""
            }`}
          >
            {quickPreview}
          </div>
        </div>
        <div
          className={`workbench-pane workbench-pane-results${resultsActive ? " mob-active" : ""}${
            resultsActive && tabAnimClass ? ` ${tabAnimClass}` : ""
          }`}
          id="paneResults"
        >
          {results}
        </div>
      </div>
    </div>
  );
}
