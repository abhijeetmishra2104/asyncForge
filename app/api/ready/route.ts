import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma"; // Use the shared instance

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ready" }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ status: "unavailable", error: "Database not reachable" }, { status: 503 });
  }
}