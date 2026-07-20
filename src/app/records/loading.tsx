/** UX-AF T147: records route skeleton (title + tab pills + 2 cards). */
export default function Loading() {
  return (
    <div className="container" style={{ maxWidth: 900, paddingBottom: 48 }}>
      <div className="skel" style={{ width: 100, height: 20, marginBottom: 16 }} />
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <div
            className="skel"
            key={i}
            style={{ width: 70, height: 32, borderRadius: 999 }}
          />
        ))}
      </div>
      <div
        className="skel"
        style={{ height: 120, borderRadius: "var(--radius-m)", marginBottom: 11 }}
      />
      <div className="skel" style={{ height: 120, borderRadius: "var(--radius-m)" }} />
    </div>
  );
}
