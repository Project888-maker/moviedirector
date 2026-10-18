import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { formatUsd } from "@/lib/pricing";
import { TOP_UP_AMOUNTS_USD, stripe } from "@/lib/stripe";
import { creditCheckoutSession } from "@/lib/topups";
import TopUpButton from "./TopUpButton";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; canceled?: string; session_id?: string }>;
}) {
  let user = await getCurrentUser();
  if (!user) redirect("/login");
  const { success, canceled, session_id: sessionId } = await searchParams;

  // Back from Stripe Checkout: confirm the payment with Stripe directly so credit shows up
  // immediately, even if the webhook is slow or misconfigured. Crediting is idempotent.
  let paid = Boolean(success);
  if (sessionId?.startsWith("cs_")) {
    try {
      const checkout = await stripe().checkout.sessions.retrieve(sessionId);
      if (checkout.metadata?.userId === user.id && checkout.payment_status === "paid") {
        paid = true;
        if (await creditCheckoutSession(checkout)) {
          user = (await getCurrentUser()) ?? user;
        }
      }
    } catch (error) {
      console.error("Could not confirm Checkout Session", sessionId, error);
    }
  }

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
        {paid && <p className="success">Payment received. Thank you! Your credit has been added.</p>}
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
