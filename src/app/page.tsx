import Link from "next/link";
import { priceTable } from "@/lib/pricing";

export default function Home() {
  const prices = priceTable();
  return (
    <main className="container">
      <section className="hero">
        <h1>Direct your own movie, live.</h1>
        <p>
          Upload your characters, describe the scene, and steer the story in real time while
          the AI films it. Pay only for the seconds you generate.
        </p>
        <Link href="/signup" className="button">Start directing</Link>
      </section>
      <section className="panel">
        <h2>Pricing</h2>
        <table>
          <thead><tr><th>Resolution</th><th>Per minute of footage</th></tr></thead>
          <tbody>
            {prices.map((p) => (
              <tr key={p.resolution}><td>{p.resolution}</td><td>${p.perMinuteUsd.toFixed(2)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
