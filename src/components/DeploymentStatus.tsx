"use client";

import { useState } from "react";

type StatusPayload = {
  supabase: boolean;
  aiProvider: { openai: boolean; claude: boolean };
  shopify: boolean;
  shopifyMock: boolean;
};

export function DeploymentStatus() {
  const [open, setOpen] = useState(false);
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

  function toggle() {
    setOpen((current) => !current);
    if (!open && !status) checkStatus();
  }

  return (
    <div className="header-status-wrap">
      <button className="header-status-toggle" onClick={toggle} type="button">
        部署 <span>{open ? "▴" : "▾"}</span>
      </button>
      <div className={`header-status status-body${open ? " open" : ""}`}>
        <div className={`status-pill${status ? (status.supabase ? " status-ok" : " status-warn") : ""}`}>
          <strong>Supabase</strong>{!status ? "未檢查" : status.supabase ? "已連線" : "連線失敗"}
        </div>
        <div className={`status-pill${status ? (status.aiProvider.openai ? " status-ok" : " status-warn") : ""}`}>
          <strong>OpenAI</strong>{!status ? "未檢查" : status.aiProvider.openai ? "已設定" : "未設定"}
        </div>
        <div className={`status-pill${status ? (status.aiProvider.claude ? " status-ok" : " status-warn") : ""}`}>
          <strong>Claude</strong>{!status ? "未檢查" : status.aiProvider.claude ? "已設定" : "未設定"}
        </div>
        <div className={`status-pill${status ? (status.shopify ? " status-ok" : " status-warn") : ""}`}>
          <strong>Shopify</strong>
          {!status ? "未檢查" : status.shopify ? (status.shopifyMock ? "已設定（mock-safe）" : "已設定") : "未設定"}
        </div>
        <button className="btn-mini" disabled={checking} onClick={checkStatus} type="button">
          {checking ? "檢查中..." : "檢查連線"}
        </button>
      </div>
    </div>
  );
}
