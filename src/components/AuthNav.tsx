"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient, hasSupabaseBrowserEnv } from "@/lib/supabase/client";

export function AuthNav() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSupabaseBrowserEnv()) return;
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setEmail(null);
    router.push("/login");
    router.refresh();
  }

  if (!email) {
    return <Link href="/login">登入</Link>;
  }

  return (
    <button onClick={signOut} title={email} type="button">
      登出
    </button>
  );
}
