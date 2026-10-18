"use client";

import { useState } from "react";
import Link from "next/link";

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });
    if (res.ok) {
      window.location.href = "/studio";
      return;
    }
    setError((await res.json().catch(() => null))?.error ?? "Something went wrong.");
    setBusy(false);
  }

  return (
    <form className="panel auth" onSubmit={onSubmit}>
      <h2>{mode === "login" ? "Log in" : "Create your account"}</h2>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" required autoComplete="email" />
      <label htmlFor="password">Password</label>
      <input
        id="password" name="password" type="password" required minLength={8}
        autoComplete={mode === "login" ? "current-password" : "new-password"}
      />
      {error && <p className="error">{error}</p>}
      <p><button type="submit" disabled={busy} style={{ width: "100%" }}>
        {mode === "login" ? "Log in" : "Sign up"}
      </button></p>
      <p className="muted">
        {mode === "login"
          ? <>No account? <Link href="/signup">Sign up</Link></>
          : <>Already have an account? <Link href="/login">Log in</Link></>}
      </p>
    </form>
  );
}
