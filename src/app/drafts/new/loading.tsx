export default function NewDraftLoading() {
  return (
    <main className="container">
      <div className="grid">
        <div className="panel">
          <div className="panel-header">
            <h2>✦ 新增商品</h2>
          </div>
          <div className="panel-body">
            <div className="skel" style={{ height: 60, marginBottom: 14 }} />
            <div className="skel" style={{ height: 90, marginBottom: 14 }} />
            <div className="skel" style={{ height: 60, marginBottom: 14 }} />
            <div className="skel" style={{ height: 120, marginBottom: 14 }} />
            <div className="skel" style={{ height: 44 }} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-header">
            <h2>◈ 生成結果</h2>
          </div>
          <div className="panel-body">
            {Array.from({ length: 3 }).map((_, index) => (
              <div className="skel" key={index} style={{ height: 64, marginBottom: 10 }} />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
