import Link from "next/link";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { formatUsd } from "@/lib/pricing";
import LogoutButton from "./LogoutButton";
import Logo from "./Logo";

export default async function Nav() {
  const user = await getCurrentUser();
  return (
    <nav className="nav">
      <Link href="/" className="brand" aria-label="AI Movie Director home"><Logo /></Link>
      {user ? (
        <>
          <Link href="/studio">Studio</Link>
          <Link href="/billing" className="hide-sm">Billing</Link>
          {isAdmin(user.email) && <Link href="/admin" className="hide-sm">Admin</Link>}
          <Link href="/billing" className="balance" title="Top up credit">{formatUsd(user.balanceMc)}</Link>
          <LogoutButton />
        </>
      ) : (
        <>
          <Link href="/#how" className="hide-sm">How it works</Link>
          <Link href="/#pricing" className="hide-sm">Pricing</Link>
          <Link href="/login">Log in</Link>
          <Link href="/signup" className="button">Start directing</Link>
        </>
      )}
    </nav>
  );
}
