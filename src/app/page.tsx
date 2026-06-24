import Link from "next/link";

export default function HomePage() {
  return (
    <main className="container">
      <section className="panel">
        <div className="panel-header">
          <h1>v0.1 安全骨架</h1>
          <span className="status pending">mock-safe</span>
        </div>
        <div className="panel-body">
          <p className="muted">
            這版先跑通 PWA 商品輸入、Supabase 佇列、扣哥 Skill worker 回寫契約、
            審核頁、Shopify payload 介面與 Matrixify 備援。
          </p>
          <div className="nav">
            <Link className="button primary" href="/drafts/new">新增商品草稿</Link>
            <Link className="button" href="/drafts">查看商品佇列</Link>
            <Link className="button" href="/review">待審核清單</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
