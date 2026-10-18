import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { formatUsd } from "@/lib/pricing";
import { TOP_UP_AMOUNTS_USD } from "@/lib/stripe";
import TopUpButton from "./TopUpButton";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; canceled?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { success, canceled } = await searchParams;

  const [topUps, sessions] = await Promise.all([
    db.topUp.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.renderSession.findMany({
      where: { userId: user.id, chargedMc: { gt: 0 } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <main className="container grid">
      <section className="panel">
        <h1>Credits</h1>
        <p>Balance: <b>{formatUsd(user.balanceMc)}</b></p>
        {success && <p className="success">Payment received. Credits appear as soon as Stripe confirms it.</p>}
        {canceled && <p className="muted">Checkout canceled.</p>}
        <div className="grid cards">
          {TOP_UP_AMOUNTS_USD.map((amount) => (
            <div className="panel card" key={amount}>
              <b>${amount}</b>
              <TopUpButton amountUsd={amount} />
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Usage</h2>
        <table>
          <thead><tr><th>Date</th><th>Resolution</th><th>Seconds</th><th>Cost</th></tr></thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.createdAt.toLocaleString()}</td>
                <td>{s.resolution}</td>
                <td>{s.billedSeconds.toFixed(0)}</td>
                <td>{formatUsd(s.chargedMc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Top-ups</h2>
        <table>
          <thead><tr><th>Date</th><th>Amount</th></tr></thead>
          <tbody>
            {topUps.map((t) => (
              <tr key={t.id}><td>{t.createdAt.toLocaleString()}</td><td>{formatUsd(t.amountMc)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
