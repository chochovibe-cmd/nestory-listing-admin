import Link from "next/link";

/**
 * C1 dead placeholder for unbuilt routes (Q4-A).
 * Title +「即將推出」+ link home only — no fake controls (B18 safety).
 */
export function ComingSoonPage({ title }: { title: string }) {
  return (
    <main className="container coming-soon">
      <h1 className="coming-soon-title">{title}</h1>
      <p className="coming-soon-msg">即將推出</p>
      <p>
        <Link className="button" href="/drafts/new">
          回工作檯
        </Link>
      </p>
    </main>
  );
}
