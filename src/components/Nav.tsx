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
  );
}
