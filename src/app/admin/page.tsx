import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { formatUsd, markupPercent } from "@/lib/pricing";
import { LOW_BALANCE_USD, getAlerts, getAutoPause, getFalBalance, getMaintenance } from "@/lib/status";
import StatusControls from "./StatusControls";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.email)) notFound();

  const [usage, jobs, director, topUps, users, balances] = await Promise.all([
    db.renderSession.aggregate({ _sum: { chargedMc: true, falCostMc: true, billedSeconds: true }, _count: true }),
    // Refunded (failed) jobs cost the user nothing, so they don't count.
    db.job.aggregate({ where: { refunded: false }, _sum: { chargedMc: true, falCostMc: true }, _count: true }),
    db.directorChat.aggregate({ _sum: { aiChargedMc: true, aiCostMc: true }, _count: true }),
    db.topUp.aggregate({ _sum: { amountMc: true } }),
    db.user.count(),
    db.user.aggregate({ _sum: { balanceMc: true } }),
  ]);
  const charged = (usage._sum.chargedMc ?? 0) + (jobs._sum.chargedMc ?? 0) + (director._sum.aiChargedMc ?? 0);
  // fal for generations, Anthropic for the AI Director.
  const falCost = (usage._sum.falCostMc ?? 0) + (jobs._sum.falCostMc ?? 0) + (director._sum.aiCostMc ?? 0);

  const stats = [
    ["Users", String(users)],
    ["Top-ups received", formatUsd(topUps._sum.amountMc ?? 0)],
    ["Unspent user credit", formatUsd(balances._sum.balanceMc ?? 0)],
    ["Live studio seconds", (usage._sum.billedSeconds ?? 0).toFixed(0)],
    ["Create jobs", String(jobs._count)],
    ["AI Director chats", String(director._count)],
    ["AI Director charged", formatUsd(director._sum.aiChargedMc ?? 0)],
    ["Charged to users", formatUsd(charged)],
    ["Estimated AI cost (fal + Anthropic)", formatUsd(falCost)],
    [`Your profit (${markupPercent}% markup)`, formatUsd(charged - falCost)],
  ];

  const [maintenance, autoPause, alerts, falBalance] = await Promise.all([getMaintenance(), getAutoPause(), getAlerts(), getFalBalance()]);
  const unspent = balances._sum.balanceMc ?? 0;

  return (
    <main className="container">
      <h1>Admin</h1>
      <section className="panel admin-status">
        <h2>Service status</h2>
        <div className="grid cards">
          <div className="panel card">
            <b className={"usd" in falBalance && falBalance.usd < LOW_BALANCE_USD ? "warn-text" : ""}>{"usd" in falBalance ? `$${falBalance.usd.toFixed(2)}` : "—"}</b>
            <span className="muted">fal balance{"error" in falBalance ? `: ${falBalance.error}` : ` (warning below $${LOW_BALANCE_USD})`}</span>
          </div>
          <div className="panel card">
            <b>{formatUsd(unspent)}</b>
            <span className="muted">Customers&apos; unspent credit. Keep fal + Anthropic at least this high.</span>
          </div>
          <div className="panel card">
            <b>{alerts.some((a) => a.provider === "anthropic") ? "Out of credit" : "OK"}</b>
            <span className="muted">Anthropic (AI Director). It has no balance API, so this shows whether it refused for lack of credit. <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noreferrer">Billing</a></span>
          </div>
        </div>
        <StatusControls maintenance={maintenance} autoPause={autoPause} alerts={alerts} />
      </section>
      <h2>Business</h2>
      <div className="grid cards">
        {stats.map(([label, value]) => (
          <div className="panel card" key={label}><b>{value}</b><span className="muted">{label}</span></div>
        ))}
      </div>
    </main>
  );
}
