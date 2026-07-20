"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

type StatusPayload = {
  supabase: boolean;
  aiProvider: { openai: boolean; claude: boolean };
  shopify: boolean;
  shopifyMock: boolean;
};

type RowValue = {
  text: string;
  tone: "ok" | "warn" | "muted";
};

function valueClass(tone: RowValue["tone"]): string {
  if (tone === "ok") return "value ok";
  if (tone === "warn") return "value warn";
  return "value";
}

export function DeploymentStatus() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [checking, setChecking] = useState(false);

  async function checkStatus() {
    setChecking(true);
    try {
      const response = await fetch("/api/status");
      setStatus(await response.json());
    } catch {
      setStatus(null);
    } finally {
      setChecking(false);
    }
  }

  const supabase: RowValue = !status
    ? { text: "未檢查", tone: "muted" }
    : status.supabase
      ? { text: "已連線", tone: "ok" }
      : { text: "連線失敗", tone: "warn" };

  const openai: RowValue = !status
    ? { text: "未檢查", tone: "muted" }
    : status.aiProvider.openai
      ? { text: "已設定", tone: "ok" }
      : { text: "未設定", tone: "warn" };

  const claude: RowValue = !status
    ? { text: "未檢查", tone: "muted" }
    : status.aiProvider.claude
      ? { text: "已設定", tone: "ok" }
      : { text: "未設定", tone: "warn" };

  const shopify: RowValue = !status
    ? { text: "未檢查", tone: "muted" }
    : status.shopify
      ? {
          text: status.shopifyMock ? "已設定（mock-safe）" : "已設定",
          tone: "ok"
        }
      : { text: "未設定", tone: "warn" };

  const rows: { label: string; value: RowValue }[] = [
    { label: "Supabase", value: supabase },
    { label: "OpenAI", value: openai },
    { label: "Claude", value: claude },
    { label: "Shopify", value: shopify }
  ];

  return (
    <div className="deploy-status-list">
      {rows.map((row) => (
        <div className="deploy-status-row" key={row.label}>
          <span className="label">{row.label}</span>
          <span className={valueClass(row.value.tone)}>{row.value.text}</span>
        </div>
      ))}
      <Button
        className="deploy-status-check"
        disabled={checking}
        fullWidth
        onClick={checkStatus}
        size="sm"
        type="button"
      >
        {checking ? "檢查中..." : "檢查連線"}
      </Button>
    </div>
  );
}
