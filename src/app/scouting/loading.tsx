/** UX-AF T149: scouting route skeleton (title + chips + input). */
export default function Loading() {
  return (
    <div className="container scout-page">
      <div className="skel" style={{ width: 120, height: 20, marginBottom: 16 }} />
      <div style={{ display: "flex", gap: 7, marginBottom: 16 }}>
        <div className="skel" style={{ width: 100, height: 32, borderRadius: 999 }} />
        <div className="skel" style={{ width: 100, height: 32, borderRadius: 999 }} />
      </div>
      <div
        className="skel"
        style={{ height: 42, borderRadius: "var(--radius-s)", marginBottom: 11 }}
      />
    </div>
  );
}
