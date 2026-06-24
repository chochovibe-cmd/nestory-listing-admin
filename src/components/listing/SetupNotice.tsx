import Link from "next/link";

export function SetupNotice({ title = "尚未連接 Supabase" }: { title?: string }) {
  return (
    <main className="container">
      <section className="panel">
        <div className="panel-header">
          <h1>{title}</h1>
        </div>
        <div className="panel-body">
          <div className="notice">
            目前是 v0.1 mock-safe 骨架模式。請先設定測試用 Supabase env，再進行商品新增、圖片上傳與審核流程。
          </div>
          <p className="muted">
            需要的變數請參考 <code>.env.example</code>，Storage 與 RLS 設定請看{" "}
            <Link href="/login">登入頁</Link> 與專案內的部署文件。
          </p>
        </div>
      </section>
    </main>
  );
}
