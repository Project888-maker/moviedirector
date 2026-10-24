import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { publicJob } from "@/lib/jobs";
import { CreationsGrid } from "../create/Creations";

export const metadata: Metadata = { title: "My creations · AI Movie Director" };

export default async function LibraryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const jobs = await db.job.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });

  return (
    <main className="container">
      <header className="pg-head">
        <div>
          <h1>My creations</h1>
          <p className="muted">
            Everything you make in Create. Download a result, or send it to the next tool. Live studio takes are
            saved to your device when you stop recording.
          </p>
        </div>
        <Link href="/create" className="btn primary">Create something</Link>
      </header>
      <CreationsGrid initialJobs={jobs.map(publicJob)} />
    </main>
  );
}
