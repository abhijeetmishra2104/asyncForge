"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/client-auth";

type Status = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

type JobState = {
  id: string;
  status: Status;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  output?: {
    summary: string;
    actionItems?: {
      title: string;
      description: string;
      priority: "HIGH" | "MEDIUM" | "LOW";
    }[];
    nextSteps?: string[];
  };
  error?: string;
};

const isTerminal = (s: Status) => s === "COMPLETED" || s === "FAILED";

/** Stop polling a job that never settles, rather than hammering the API forever. */
const POLL_CEILING_MS = 10 * 60 * 1000;
/** Transient failures to tolerate before telling the user the connection is gone. */
const FAILURES_BEFORE_GIVING_UP = 3;

/**
 * Poll hard while a job is young, then ease off — most finish in the first 30s.
 * The first window is 1s because a result that is ready is otherwise invisible
 * for up to another full interval, which is pure added latency for the user.
 */
function pollDelay(elapsedMs: number): number {
  if (elapsedMs < 30_000) return 1_000;
  if (elapsedMs < 120_000) return 3_000;
  return 10_000;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/* ---------------------------------------------------------------------------
   The pipeline, as it actually happened to this job. "Accepted" is always
   complete — the row could not be read if the API had not accepted it.
--------------------------------------------------------------------------- */

const STAGES = ["Accepted", "Queued", "Processing", "Completed"] as const;

function reachedStage(status: Status): number {
  switch (status) {
    case "QUEUED":
      return 1;
    case "PROCESSING":
      return 2;
    case "COMPLETED":
      return 3;
    case "FAILED":
      return 2;
  }
}

function Pipeline({ status }: { status: Status }) {
  const current = reachedStage(status);
  const failed = status === "FAILED";

  return (
    <ol className="grid grid-cols-2 sm:grid-cols-4 gap-3" aria-label="Job pipeline">
      {STAGES.map((stage, i) => {
        const done = i < current || status === "COMPLETED";
        const active = i === current && !isTerminal(status);
        const broke = failed && i === current;

        return (
          <li
            key={stage}
            aria-current={active ? "step" : undefined}
            className={`border-4 border-black px-3 py-3 font-black uppercase text-sm tracking-tight flex items-center gap-2
              ${broke ? "bg-red-500 text-white shadow-[4px_4px_0px_0px_#000]" : ""}
              ${!broke && done ? "bg-[#14b8a6] shadow-[4px_4px_0px_0px_#000]" : ""}
              ${!broke && active ? "bg-[#ffe900] shadow-[6px_6px_0px_0px_#000] motion-safe:animate-pulse" : ""}
              ${!broke && !done && !active ? "bg-white text-black/35 shadow-[2px_2px_0px_0px_#000]" : ""}
            `}
          >
            <span aria-hidden="true" className="text-base leading-none">
              {broke ? "✕" : done ? "✓" : active ? "▶" : "•"}
            </span>
            {stage}
          </li>
        );
      })}
    </ol>
  );
}

export default function JobStatusPage() {
  const params = useParams();
  const jobId = String(params.jobId);

  const [job, setJob] = useState<JobState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0); // bumping this restarts polling

  const startedAtRef = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let consecutiveFailures = 0;
    startedAtRef.current = Date.now();

    const poll = async () => {
      try {
        const res = await apiFetch(`/api/status/${jobId}`);

        if (res.status === 404) {
          setFatal("No job with this ID belongs to this browser.");
          return;
        }
        if (res.status === 401) {
          setFatal("This browser is no longer registered. Submit a new task to continue.");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data: JobState = await res.json();
        if (cancelled) return;

        consecutiveFailures = 0;
        setWarning(null);
        setJob(data);

        // Settled. Stop polling rather than leaving an interval running.
        if (isTerminal(data.status)) return;
      } catch {
        if (cancelled) return;

        consecutiveFailures += 1;
        if (consecutiveFailures >= FAILURES_BEFORE_GIVING_UP) {
          setFatal("Lost contact with the API. Check your connection and retry.");
          return;
        }
        setWarning("Connection hiccup — still trying.");
      }

      const elapsed = Date.now() - startedAtRef.current;
      if (elapsed > POLL_CEILING_MS) {
        setStalled(true);
        return;
      }
      timer = setTimeout(poll, pollDelay(elapsed));
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, attempt]);

  // Drives the elapsed counter. Runs only while the job is still moving.
  const live = job !== null && !isTerminal(job.status) && !fatal && !stalled;
  useEffect(() => {
    if (!live) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [live]);

  const retry = useCallback(() => {
    setFatal(null);
    setWarning(null);
    setStalled(false);
    setAttempt((n) => n + 1);
  }, []);

  if (fatal) {
    return (
      <main className="max-w-2xl mx-auto px-6 py-16 space-y-6">
        <div className="bg-red-500 text-white border-4 border-black p-6 shadow-[8px_8px_0px_0px_#000]">
          <h1 className="text-2xl font-black uppercase mb-2">Can&apos;t load this job</h1>
          <p className="font-bold">{fatal}</p>
        </div>
        <div className="flex flex-wrap gap-4">
          <button onClick={retry} className={buttonClass}>
            Try again
          </button>
          <Link href="/demo" className={buttonClass}>
            New task
          </Link>
        </div>
      </main>
    );
  }

  if (!job) {
    return (
      <main className="max-w-2xl mx-auto px-6 py-16">
        <p className="text-2xl font-black text-center motion-safe:animate-pulse">Loading job…</p>
      </main>
    );
  }

  const endedAt = job.completedAt ? new Date(job.completedAt).getTime() : now;
  const elapsed = endedAt - new Date(job.createdAt).getTime();
  const retrying = job.attempts > 1;

  return (
    <main className="max-w-4xl mx-auto px-6 py-10 space-y-10">
      {/* --- headline state ------------------------------------------------ */}
      <header className="space-y-5">
        <div
          className={`border-4 border-black p-6 shadow-[8px_8px_0px_0px_#000] flex flex-wrap justify-between items-center gap-4
            ${job.status === "QUEUED" ? "bg-[#ffb000]" : ""}
            ${job.status === "PROCESSING" ? "bg-[#ff90e8]" : ""}
            ${job.status === "COMPLETED" ? "bg-[#14b8a6]" : ""}
            ${job.status === "FAILED" ? "bg-red-500 text-white" : ""}`}
        >
          <h1 className="text-3xl font-black uppercase tracking-tight">{job.status}</h1>

          <div className="flex items-center gap-3 font-black">
            <span
              className="bg-black text-white px-3 py-1 tabular-nums"
              aria-label={`${isTerminal(job.status) ? "Took" : "Running for"} ${formatDuration(elapsed)}`}
            >
              {isTerminal(job.status) ? "took " : ""}
              {formatDuration(elapsed)}
            </span>
            {retrying && (
              <span className="bg-white text-black border-2 border-black px-3 py-1">
                attempt {job.attempts} of {job.maxAttempts}
              </span>
            )}
          </div>
        </div>

        <Pipeline status={job.status} />

        {retrying && !isTerminal(job.status) && (
          <p className="font-bold bg-white border-4 border-black p-4 shadow-[4px_4px_0px_0px_#000]">
            The first attempt failed and the message was redelivered. Nothing was lost — a worker
            picked it back up.
          </p>
        )}

        {warning && (
          <p className="font-bold bg-[#ffb000] border-4 border-black p-3 shadow-[4px_4px_0px_0px_#000]">
            {warning}
          </p>
        )}

        {stalled && (
          <div className="bg-white border-4 border-black p-4 shadow-[4px_4px_0px_0px_#000] flex flex-wrap items-center justify-between gap-4">
            <p className="font-bold">
              Still running after 10 minutes. Stopped checking to save battery.
            </p>
            <button onClick={retry} className={buttonClass}>
              Keep waiting
            </button>
          </div>
        )}
      </header>

      {/* --- failure -------------------------------------------------------- */}
      {job.status === "FAILED" && (
        <section className="bg-white border-4 border-black p-6 shadow-[6px_6px_0px_0px_#000] space-y-3">
          <div className="bg-black text-white text-sm font-bold inline-block px-3 py-1">
            WHAT WENT WRONG
          </div>
          <p className="font-bold break-words">{job.error ?? "No error detail was recorded."}</p>
          <p className="font-medium">
            It was retried {job.attempts} {job.attempts === 1 ? "time" : "times"} before giving up.
          </p>
        </section>
      )}

      {/* --- result --------------------------------------------------------- */}
      {job.status === "COMPLETED" && job.output && (
        <div className="space-y-10">
          <section className="bg-[#ffe900] p-6 border-4 border-black shadow-[6px_6px_0px_0px_#000]">
            <div className="bg-black text-white text-sm font-bold inline-block px-3 py-1 mb-4">
              SUMMARY
            </div>
            <p className="text-xl font-bold">{job.output.summary ?? "No summary generated."}</p>
          </section>

          {job.output.actionItems && job.output.actionItems.length > 0 && (
            <section>
              <h2 className="font-black text-3xl mb-6 bg-white inline-block px-4 py-2 border-4 border-black shadow-[4px_4px_0px_0px_#000]">
                Action Items
              </h2>
              <div className="grid gap-6">
                {job.output.actionItems.map((item, idx) => (
                  <article
                    key={idx}
                    className="bg-white p-6 border-4 border-black shadow-[6px_6px_0px_0px_#000] flex flex-col sm:flex-row sm:items-start justify-between gap-4"
                  >
                    <div>
                      <h3 className="font-black text-xl mb-2">{item.title}</h3>
                      <p className="font-medium text-gray-800">{item.description}</p>
                    </div>
                    <span
                      className={`whitespace-nowrap font-black border-4 border-black px-3 py-1 shadow-[4px_4px_0px_0px_#000] uppercase
                        ${item.priority === "HIGH" ? "bg-[#ff90e8]" : ""}
                        ${item.priority === "MEDIUM" ? "bg-[#00f0ff]" : ""}
                        ${item.priority === "LOW" ? "bg-[#14b8a6]" : ""}`}
                    >
                      {item.priority}
                    </span>
                  </article>
                ))}
              </div>
            </section>
          )}

          {job.output.nextSteps && job.output.nextSteps.length > 0 && (
            <section>
              <h2 className="font-black text-3xl mb-6 bg-white inline-block px-4 py-2 border-4 border-black shadow-[4px_4px_0px_0px_#000]">
                Next Steps
              </h2>
              <ol className="bg-[#b19cd9] border-4 border-black shadow-[8px_8px_0px_0px_#000] p-8 space-y-4">
                {job.output.nextSteps.map((step, idx) => (
                  <li key={idx} className="flex gap-4 items-start font-bold text-lg">
                    <span className="bg-black text-white px-2 py-0.5 border-2 border-black shrink-0">
                      {idx + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}

      {isTerminal(job.status) && (
        <div className="flex flex-wrap gap-4 pt-2">
          <Link href="/demo" className={buttonClass}>
            Run another task
          </Link>
        </div>
      )}
    </main>
  );
}

const buttonClass =
  "inline-block bg-black text-white border-4 border-black font-black uppercase px-6 py-3 shadow-[6px_6px_0px_0px_#ffe900] hover:-translate-y-1 hover:shadow-[10px_10px_0px_0px_#ffe900] active:translate-y-1 active:shadow-[2px_2px_0px_0px_#ffe900] focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-[#14b8a6] transition-all";
