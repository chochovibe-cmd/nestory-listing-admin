"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, hasSupabaseBrowserEnv } from "@/lib/supabase/client";
import {
  translateLoginError,
  type LoginErrorKind
} from "@/lib/auth/loginErrors";

export default function LoginPage() {
  const router = useRouter();
  const supabaseReady = hasSupabaseBrowserEnv();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [hint, setHint] = useState("");
  const [errorKind, setErrorKind] = useState<LoginErrorKind | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabaseReady) {
      setErrorKind("config");
      setMessage("尚未設定登入環境");
      setHint("請管理員先設定 Supabase 測試環境變數。");
      return;
    }

    setSubmitting(true);
    setMessage("");
    setHint("");
    setErrorKind(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setSubmitting(false);
      const view = translateLoginError(error);
      setErrorKind(view.kind);
      setMessage(view.message);
      setHint(view.hint ?? "");
      return;
    }

    router.push("/drafts/new");
    router.refresh();
  }

  return (
    <main className="container">
      <form className="panel login-panel" onSubmit={signIn}>
        <div className="panel-header login-panel-header">
          <div className="login-brand">
            <span className="brand-dot" aria-hidden="true" />
            <h1 className="login-brand-title">潮巢 商品上架助手</h1>
            <p className="login-brand-sub">團隊登入</p>
          </div>
        </div>
        <div className="panel-body">
          {!supabaseReady ? (
            <div className="notice">
              目前是 mock-safe 骨架模式，尚未設定 `NEXT_PUBLIC_SUPABASE_URL` 與
              `NEXT_PUBLIC_SUPABASE_ANON_KEY`。
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              value={email}
              autoComplete="username"
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
              autoComplete="current-password"
            />
          </div>
          <button className="primary" disabled={submitting} type="submit">
            {submitting ? (
              <>
                登入中
                <span aria-hidden className="spinner" />
              </>
            ) : (
              "登入"
            )}
          </button>
          {message ? (
            <div
              className={`notice login-error${errorKind ? ` login-error--${errorKind}` : ""}`}
              role="alert"
            >
              <div className="login-error-main">{message}</div>
              {hint ? <div className="login-error-hint muted">{hint}</div> : null}
            </div>
          ) : null}
        </div>
      </form>
    </main>
  );
}
