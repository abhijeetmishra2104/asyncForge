import { registry } from "@/lib/metrics";
import { NextResponse } from "next/server";

// Prometheus requires this to be dynamic so it serves fresh metrics on every scrape
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const metrics = await registry.metrics();
    return new NextResponse(metrics, {
      status: 200,
      headers: {
        "Content-Type": registry.contentType,
      },
    });
  } catch (error) {
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}