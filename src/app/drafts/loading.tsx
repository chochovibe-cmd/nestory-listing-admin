export default function DraftQueueLoading() {
  return (
    <main className="container">
      <section className="panel">
        <div className="panel-header">
          <h1>商品佇列</h1>
        </div>
        <div className="panel-body">
          <div className="skel" style={{ height: 32, marginBottom: 12, width: 260 }} />
          <div className="skel" style={{ height: 44, marginBottom: 14 }} />
          {Array.from({ length: 5 }).map((_, index) => (
            <div className="skel" key={index} style={{ height: 56, marginBottom: 8 }} />
          ))}
        </div>
      </section>
    </main>
  );
}
