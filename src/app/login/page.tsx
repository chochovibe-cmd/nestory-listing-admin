"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, hasSupabaseBrowserEnv } from "@/lib/supabase/client";

// Supabase auth errors come back in English -- translate the ones an
// operator will actually hit so they're not left guessing what a phrase
// like "Invalid login credentials" means.
const AUTH_ERROR_LABELS: Record<string, string> = {
  "Invalid login credentials": "帳號或密碼錯誤，請再確認一次",
  "Email not confirmed": "此信箱尚未完成驗證，請至信箱收件匣確認",
  "Email rate limit exceeded": "嘗試次數過多，請稍後再試",
  "User not found": "找不到此帳號"
};

function translateAuthError(message: string): string {
  return AUTH_ERROR_LABELS[message] ?? message;
}

export default function LoginPage() {
  const router = useRouter();
  const supabaseReady = hasSupabaseBrowserEnv();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabaseReady) {
      setMessage("尚未設定 Supabase public env，請先設定測試環境。");
      return;
    }

    setSubmitting(true);
    setMessage("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setSubmitting(false);
      setMessage(translateAuthError(error.message));
      return;
    }

    router.push("/drafts/new");
    router.refresh();
  }

  return (
    <main className="container">
      <form className="panel" onSubmit={signIn}>
        <div className="panel-header">
          <h1>團隊登入</h1>
        </div>
        <div className="panel-body">
          {!supabaseReady ? (
            <div className="notice">
              目前是 mock-safe 骨架模式，尚未設定 `NEXT_PUBLIC_SUPABASE_URL` 與
              `NEXT_PUBLIC_SUPABASE_ANON_KEY`。
            </div>
          ) : null}
          <div className="field">
            <label>Email</label>
            <input onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
          </div>
          <div className="field">
            <label>Password</label>
            <input onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
          </div>
          <button className="primary" disabled={submitting} type="submit">
            {submitting ? "登入中..." : "登入"}
          </button>
          {message ? <div className="notice">{message}</div> : null}
        </div>
      </form>
    </main>
  );
}
