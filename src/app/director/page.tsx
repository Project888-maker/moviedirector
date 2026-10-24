import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import Director from "./Director";

export const metadata: Metadata = { title: "AI Director · AI Movie Director" };

export default async function DirectorPage({ searchParams }: { searchParams: Promise<{ chat?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { chat } = await searchParams;
  const chats = await db.directorChat.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, updatedAt: true },
  });
  const active = chat && chats.some((c) => c.id === chat) ? chat : null;

  return (
    <main className="dir-page">
      <Director
        initialChats={chats.map((c) => ({ ...c, updatedAt: c.updatedAt.toISOString() }))}
        initialChatId={active}
        initialBalanceMc={user.balanceMc}
      />
    </main>
  );
}
