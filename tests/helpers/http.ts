import { NextRequest } from "next/server";
import { POST as registerRoute } from "@/app/api/devices/route";
import { POST as analyzeRoute } from "@/app/api/analyze/route";
import { GET as statusRoute } from "@/app/api/status/[jobId]/route";

/**
 * Calls the real Next.js route handlers in-process. Same code that serves
 * app.asyncforge.me, minus the HTTP server in front of it.
 */

function request(path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export async function registerDevice(): Promise<string> {
  const res = await registerRoute(request("/api/devices", { method: "POST", body: { platform: "web" } }));
  if (res.status !== 201) throw new Error(`device registration returned ${res.status}`);
  return (await res.json()).token;
}

export async function submitTask(token: string | undefined, prompt: string) {
  const res = await analyzeRoute(request("/api/analyze", { method: "POST", token, body: { prompt } }));
  return { status: res.status, body: await res.json() };
}

export async function getStatus(token: string, jobId: string) {
  const res = await statusRoute(request(`/api/status/${jobId}`, { token }), { params: { jobId } });
  return { status: res.status, body: await res.json() };
}
