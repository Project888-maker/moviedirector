import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { formatUsd, markupPercent } from "@/lib/pricing";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.email)) notFound();

  const [usage, topUps, users, balances] = await Promise.all([
    db.renderSession.aggregate({ _sum: { chargedMc: true, falCostMc: true, billedSeconds: true }, _count: true }),
    db.topUp.aggregate({ _sum: { amountMc: true } }),
    db.user.count(),
    db.user.aggregate({ _sum: { balanceMc: true } }),
  ]);
  const charged = usage._sum.chargedMc ?? 0;
  const falCost = usage._sum.falCostMc ?? 0;

  const stats = [
    ["Users", String(users)],
    ["Top-ups received", formatUsd(topUps._sum.amountMc ?? 0)],
    ["Unspent user credit", formatUsd(balances._sum.balanceMc ?? 0)],
    ["Seconds generated", (usage._sum.billedSeconds ?? 0).toFixed(0)],
    ["Charged to users", formatUsd(charged)],
    ["Estimated fal cost", formatUsd(falCost)],
    [`Your profit (${markupPercent}% markup)`, formatUsd(charged - falCost)],
  ];

  return (
    <main className="container">
      <h1>Admin</h1>
      <div className="grid cards">
        {stats.map(([label, value]) => (
          <div className="panel card" key={label}><b>{value}</b><span className="muted">{label}</span></div>
        ))}
      </div>
    </main>
  );
}
