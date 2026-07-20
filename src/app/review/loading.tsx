/** UX-AF T147: review route skeleton (title + 2 stacked cards). */
export default function Loading() {
  return (
    <div className="container" style={{ maxWidth: 900, paddingBottom: 48 }}>
      <div className="skel" style={{ width: 100, height: 20, marginBottom: 16 }} />
      <div
        className="skel"
        style={{ height: 200, borderRadius: "var(--radius-m)", marginBottom: 13 }}
      />
      <div className="skel" style={{ height: 200, borderRadius: "var(--radius-m)" }} />
    </div>
  );
}
