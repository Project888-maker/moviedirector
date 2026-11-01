import Link from "next/link";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { formatUsd } from "@/lib/pricing";
import { LOW_BALANCE_USD, getAlerts, getFalBalance, getMaintenance } from "@/lib/status";
import LogoutButton from "./LogoutButton";
import Logo from "./Logo";

export default async function Nav() {
  const user = await getCurrentUser();
  const admin = !!user && isAdmin(user.email);
  const [maintenance, alerts, falBalance] = await Promise.all([
    getMaintenance().catch(() => null),
    admin ? getAlerts().catch(() => []) : Promise.resolve([]),
    admin ? getFalBalance() : Promise.resolve(null),
  ]);
  const falLow = falBalance && "usd" in falBalance && falBalance.usd < LOW_BALANCE_USD;

  return (
    <>
    <nav className="nav">
      <Link href="/" className="brand" aria-label="AI Movie Director home"><Logo /></Link>
      {user ? (
        <>
          <Link href="/director" className="nav-director">AI Director</Link>
          <Link href="/create">Create</Link>
          <Link href="/studio">Live studio</Link>
          <Link href="/library" className="hide-sm">My creations</Link>
          <Link href="/guide" className="hide-sm">Guide</Link>
          <Link href="/billing" className="hide-sm">Billing</Link>
          {isAdmin(user.email) && <Link href="/admin" className="hide-sm">Admin</Link>}
          <Link href="/billing" className="balance" title="Top up credit">{formatUsd(user.balanceMc)}</Link>
          <LogoutButton />
        </>
      ) : (
        <>
          <Link href="/create" className="hide-sm">Tools</Link>
          <Link href="/guide" className="hide-sm">Guide</Link>
          <Link href="/#how" className="hide-sm">How it works</Link>
          <Link href="/#pricing" className="hide-sm">Pricing</Link>
          <Link href="/login">Log in</Link>
          <Link href="/signup" className="button">Start directing</Link>
        </>
      )}
    </nav>
    {maintenance?.on && (
      <div className="site-banner" role="status">
        <b>Maintenance</b> {maintenance.message}
        {admin && <> · <Link href="/admin">Admin: turn it off</Link></>}
      </div>
    )}
    {admin && (alerts.length > 0 || falLow) && (
      <div className="site-banner danger" role="alert">
        <b>Action needed</b>
        {falLow && <span> fal balance is ${(falBalance as { usd: number }).usd.toFixed(2)}, below ${LOW_BALANCE_USD}. <a href="https://fal.ai/dashboard/billing" target="_blank" rel="noreferrer">Top up fal</a>.</span>}
        {alerts.map((a) => (
          <span key={a.provider}> {a.provider === "fal" ? "fal" : "Anthropic"} ran out of credit at {new Date(a.at).toLocaleTimeString()}.{" "}
            <a href={a.provider === "fal" ? "https://fal.ai/dashboard/billing" : "https://console.anthropic.com/settings/billing"} target="_blank" rel="noreferrer">Top up</a>.
          </span>
        ))}
        <Link href="/admin"> Open Admin</Link>
      </div>
    )}
    </>
  );
}
