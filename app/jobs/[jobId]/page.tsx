"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type JobState = {
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  output?: {
    summary: string;
    actionItems: { title: string; description: string; priority: string }[];
    nextSteps: string[];
  };
  error?: string;
};

export default function JobStatusPage() {
  const params = useParams();
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/status/${params.jobId}`);
        if (!res.ok) {
          if (res.status === 404) setError("Job not found.");
          return;
        }
        const data = await res.json();
        setJob(data);

        if (data.status === "COMPLETED" || data.status === "FAILED") {
          clearInterval(interval);
        }
      } catch (e) {
        console.error("Polling error", e);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, [params.jobId]);

  if (error) return <div className="p-8 text-red-500">{error}</div>;
  if (!job) return <div className="p-8">Loading job state...</div>;

  return (
    <main className="max-w-4xl mx-auto p-8">
      <h2 className="text-2xl font-bold mb-4">Job Status: {job.status}</h2>
      
      {job.status === "QUEUED" && <p className="text-gray-600 animate-pulse">Waiting for background processing...</p>}
      {job.status === "PROCESSING" && <p className="text-blue-600 animate-pulse">AI is analyzing your task...</p>}
      {job.status === "FAILED" && <p className="text-red-600 border border-red-200 p-4 rounded-md">Error: {job.error}</p>}
      
      {job.status === "COMPLETED" && job.output && (
        <div className="space-y-8 mt-8">
          <div className="bg-gray-50 p-6 rounded-lg shadow-sm border border-gray-100">
            <h3 className="font-semibold text-lg mb-2">Summary</h3>
            <p className="text-gray-800">{job.output.summary}</p>
          </div>

          <div>
            <h3 className="font-semibold text-xl border-b pb-2 mb-4">Action Items</h3>
            <div className="grid gap-4">
              {job.output.actionItems.map((item, idx) => (
                <div key={idx} className="p-4 border rounded-md bg-white shadow-sm flex flex-col sm:flex-row sm:items-start justify-between">
                  <div>
                    <h4 className="font-medium text-gray-900">{item.title}</h4>
                    <p className="text-sm text-gray-600 mt-1">{item.description}</p>
                  </div>
                  <span className={`mt-2 sm:mt-0 text-xs font-bold px-2 py-1 rounded ${
                    item.priority === 'HIGH' ? 'bg-red-100 text-red-800' :
                    item.priority === 'MEDIUM' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-green-100 text-green-800'
                  }`}>
                    {item.priority}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-xl border-b pb-2 mb-4">Next Steps</h3>
            <ul className="list-decimal pl-5 space-y-2 text-gray-800">
              {job.output.nextSteps.map((step, idx) => (
                <li key={idx}>{step}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </main>
  );
}