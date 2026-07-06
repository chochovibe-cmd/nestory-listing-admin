"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, hasSupabaseBrowserEnv } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabaseReady = hasSupabaseBrowserEnv();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabaseReady) {
      setMessage("尚未設定 Supabase public env，請先設定測試環境。");
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setMessage(error.message);
      return;
    }

    router.push("/drafts");
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
          <button className="primary" type="submit">登入</button>
          {message ? <div className="notice">{message}</div> : null}
        </div>
      </form>
    </main>
  );
}
