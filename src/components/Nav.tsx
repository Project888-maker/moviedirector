import Link from "next/link";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { formatUsd } from "@/lib/pricing";
import LogoutButton from "./LogoutButton";

export default async function Nav() {
  const user = await getCurrentUser();
  return (
    <nav className="nav">
      <Link href="/" className="brand">🎬 MovieDirector</Link>
      {user ? (
        <>
          <Link href="/studio">Studio</Link>
          <Link href="/billing">Billing</Link>
          {isAdmin(user.email) && <Link href="/admin">Admin</Link>}
          <span className="balance">{formatUsd(user.balanceMc)}</span>
          <LogoutButton />
        </>
      ) : (
        <>
          <Link href="/login">Log in</Link>
          <Link href="/signup" className="button">Sign up</Link>
        </>
      )}
    </nav>
  );
}
