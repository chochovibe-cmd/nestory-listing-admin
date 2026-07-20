/** UX-AF T147: dashboard route skeleton (title + 5 metric cards). */
export default function Loading() {
  return (
    <div className="container" style={{ maxWidth: 900, paddingBottom: 48 }}>
      <div className="skel" style={{ width: 120, height: 20, marginBottom: 16 }} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 11,
        }}
      >
        {Array.from({ length: 5 }, (_, i) => (
          <div
            className="skel"
            key={i}
            style={{ height: 90, borderRadius: "var(--radius-m)" }}
          />
        ))}
      </div>
    </div>
  );
}
