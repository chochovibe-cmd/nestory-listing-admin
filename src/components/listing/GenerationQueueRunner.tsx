"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { showToast } from "@/components/Toast";
import { rememberToneForIp } from "@/lib/drafts/toneMemory";
import {
  GENERATION_PROGRESS_EVENT,
  GENERATION_STEP_LABELS,
  type GenerationProgress,
  type StepStatus,
} from "@/components/listing/generationProgress";

export const GENERATION_QUEUE_KICK_EVENT = "nestory:generation-queue-kick";
export const REGEN_QUEUE_STATUS_EVENT = "nestory:regen-queue-status";
export type RegenQueueStatusDetail = {
  draftId: string;
  status: "queued" | "processing" | "completed" | "failed";
  field?: string | null;
  error?: string | null;
};
const MAX_LOCAL_CONCURRENCY = 2;
const POLL_MS = 4_000;

type QueueInput = {
  queueVersion: "v1.1";
  title: string;
  provider: "openai" | "claude";
  mode: "test" | "llm";
  useWebSearch: boolean;
  source?: string;
  variantSummary?: string;
  tone: string;
  copyLength: "精簡" | "標準" | "詳細";
  hasImages: boolean;
  jobKind?: "full" | "regen_full" | "regen_field";
  regenField?: string;
  regenNotes?: string;
  currentValues?: Record<string, unknown>;
};

type ClaimedJob = {
  runId: string;
  draftId: string;
  input: QueueInput;
};

function emitProgress(
  draftId: string,
  title: string,
  statuses: StepStatus[],
  error?: string,
  timingNote?: string,
) {
  const model: GenerationProgress = {
    draftId,
    visible: true,
    title,
    steps: GENERATION_STEP_LABELS.map((label, index) => ({
      label,
      status: statuses[index] ?? "pending",
    })),
    error,
    timingNote,
  };
  window.dispatchEvent(new CustomEvent<GenerationProgress>(GENERATION_PROGRESS_EVENT, { detail: model }));
}

function emitRegenStatus(detail: RegenQueueStatusDetail) {
  window.dispatchEvent(new CustomEvent<RegenQueueStatusDetail>(REGEN_QUEUE_STATUS_EVENT, { detail }));
}

async function reportNetworkFailure(job: ClaimedJob, message: string) {
  await fetch("/api/generation-queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "fail",
      draftId: job.draftId,
      runId: job.runId,
      error: message,
    }),
  }).catch(() => undefined);
}

/**
 * V1.1 persistent queue runner.
 *
 * The queue itself lives in Supabase generation_runs/product_drafts, not in
 * React state. A refresh/remount simply resumes by claiming pending DB jobs.
 * Each browser runs at most two jobs; the claim API conditionally locks a draft
 * before returning it so two tabs cannot process the same draft.
 */
export function GenerationQueueRunner() {
  const router = useRouter();
  const pathname = usePathname();
  const activeRef = useRef(0);
  const claimingRef = useRef(false);
  const pumpRef = useRef<() => void>(() => undefined);

  const processJob = useCallback(
    async (job: ClaimedJob) => {
      const title = job.input.title.trim().slice(0, 18) || "未命名商品";
      const startedAt = Date.now();
      const jobKind = job.input.jobKind ?? "full";

      if (jobKind !== "full") {
        emitRegenStatus({
          draftId: job.draftId,
          status: "processing",
          field: job.input.regenField ?? null,
        });

        let regenResponse: Response;
        try {
          regenResponse = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              draftId: job.draftId,
              queueRunId: job.runId,
              provider: job.input.provider,
              mode: job.input.mode,
              useWebSearch: job.input.useWebSearch,
              tone: job.input.tone,
              copyLength: job.input.copyLength,
              regenNotes: job.input.regenNotes,
              field: job.input.regenField,
              currentValues: job.input.currentValues,
            }),
          });
        } catch {
          const message = "重生連線失敗，原文案已保留，可重新送出。";
          await reportNetworkFailure(job, message);
          emitRegenStatus({
            draftId: job.draftId,
            status: "failed",
            field: job.input.regenField ?? null,
            error: message,
          });
          showToast(`${title}：${message}`, "error");
          return;
        }

        const regenPayload = await regenResponse.json().catch(() => ({}));
        if (!regenResponse.ok) {
          const errorText =
            typeof regenPayload.error === "string" ? regenPayload.error : "重生失敗";
          emitRegenStatus({
            draftId: job.draftId,
            status: "failed",
            field: job.input.regenField ?? null,
            error: errorText,
          });
          showToast(`${title}：${errorText}`, "error");
          router.refresh();
          return;
        }

        const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        emitRegenStatus({
          draftId: job.draftId,
          status: "completed",
          field: job.input.regenField ?? null,
        });
        showToast(
          jobKind === "regen_field"
            ? `${title}：單欄重生完成（${elapsedSeconds}s）`
            : `${title}：重新生成完成（${elapsedSeconds}s）`,
          "success",
        );
        router.refresh();
        return;
      }

      let imageStep: StepStatus = job.input.hasImages ? "active" : "done";
      const imageWarnings: string[] = [];

      emitProgress(job.draftId, title, ["done", imageStep, "pending", "pending"]);

      if (job.input.hasImages) {
        try {
          const response = await fetch("/api/analyze-images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ draftId: job.draftId }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            imageStep = "warn";
            imageWarnings.push(
              typeof payload.error === "string"
                ? `圖片辨識未完成（已略過圖片資訊繼續生成）：${payload.error}`
                : "圖片辨識未完成，已略過圖片資訊繼續生成。",
            );
          } else if (Array.isArray(payload.warnings) && payload.warnings.length > 0) {
            imageStep = "warn";
            imageWarnings.push(
              ...payload.warnings.filter((value: unknown): value is string => typeof value === "string"),
            );
          } else {
            imageStep = "done";
          }
        } catch {
          imageStep = "warn";
          imageWarnings.push("圖片辨識連線失敗，已略過圖片資訊繼續生成。");
        }
      }

      emitProgress(job.draftId, title, ["done", imageStep, "active", "pending"]);

      let response: Response;
      try {
        response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draftId: job.draftId,
            queueRunId: job.runId,
            provider: job.input.provider,
            mode: job.input.mode,
            useWebSearch: job.input.useWebSearch,
            source: job.input.source,
            variantSummary: job.input.variantSummary,
            tone: job.input.tone,
            copyLength: job.input.copyLength,
            imageWarnings,
          }),
        });
      } catch {
        const message = "生成連線失敗，工作已保留為失敗，可單件重試。";
        await reportNetworkFailure(job, message);
        emitProgress(job.draftId, title, ["done", imageStep, "error", "pending"], message);
        showToast(message, "error");
        router.refresh();
        return;
      }

      const payload = await response.json().catch(() => ({}));
      const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

      if (!response.ok) {
        const errorText = typeof payload.error === "string" ? payload.error : "生成失敗";
        emitProgress(job.draftId, title, ["done", imageStep, "error", "pending"], errorText);
        showToast(`${title}：${errorText}（可單件重試）`, "error");
        router.refresh();
        return;
      }

      if (payload.draftState === "blocked") {
        const validationText = Array.isArray(payload.validationErrors)
          ? payload.validationErrors.filter((value: unknown): value is string => typeof value === "string").join("；")
          : "";
        const errorText = validationText || "AI 判斷資料不足，請人工確認後重試。";
        emitProgress(job.draftId, title, ["done", imageStep, "error", "pending"], errorText);
        showToast(`${title}：${errorText}`, "warn");
        router.refresh();
        return;
      }

      const detectedIp =
        typeof payload.detectedIpName === "string" && payload.detectedIpName.trim()
          ? payload.detectedIpName.trim()
          : null;
      if (detectedIp) {
        rememberToneForIp(
          typeof window !== "undefined" ? window.localStorage : null,
          detectedIp,
          job.input.tone,
        );
      }

      emitProgress(
        job.draftId,
        title,
        ["done", imageStep, "done", "done"],
        undefined,
        `佇列完成 ${elapsedSeconds}s`,
      );
      showToast(`${title} 已生成完成`, "success");
      router.refresh();
    },
    [router],
  );

  const pump = useCallback(async () => {
    if (pathname === "/login" || claimingRef.current) return;
    const available = MAX_LOCAL_CONCURRENCY - activeRef.current;
    if (available <= 0) return;

    claimingRef.current = true;
    try {
      const response = await fetch("/api/generation-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim", limit: available }),
      });
      if (!response.ok) return;

      const payload = await response.json().catch(() => ({}));
      const claimed = Array.isArray(payload.claimed) ? (payload.claimed as ClaimedJob[]) : [];
      for (const job of claimed) {
        if (!job?.runId || !job?.draftId || !job?.input) continue;
        activeRef.current += 1;
        void processJob(job).finally(() => {
          activeRef.current = Math.max(0, activeRef.current - 1);
          window.setTimeout(() => pumpRef.current(), 0);
        });
      }
    } finally {
      claimingRef.current = false;
    }
  }, [pathname, processJob]);

  pumpRef.current = () => {
    void pump();
  };

  useEffect(() => {
    if (pathname === "/login") return;

    const onKick = () => {
      void pump();
    };

    void pump();
    const timer = window.setInterval(() => {
      void pump();
    }, POLL_MS);
    window.addEventListener(GENERATION_QUEUE_KICK_EVENT, onKick);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener(GENERATION_QUEUE_KICK_EVENT, onKick);
    };
  }, [pathname, pump]);

  return null;
}
