import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";

// The signed-in person's Director chats, newest first.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Not signed in.");
  const chats = await db.directorChat.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, updatedAt: true },
  });
  return NextResponse.json({ chats });
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Not signed in.");
  const chat = await db.directorChat.create({ data: { userId: user.id } });
  return NextResponse.json({ id: chat.id });
}
