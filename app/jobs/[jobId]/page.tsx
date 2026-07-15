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

  if (error) return <div className="p-8 text-white bg-black border-4 border-red-500 m-8 font-bold text-xl uppercase">{error}</div>;
  if (!job) return <div className="p-8 text-2xl font-black animate-pulse text-center mt-12">Fetching from Database...</div>;

  return (
    <main className="max-w-4xl mx-auto p-8 mt-8">
      
      {/* Status Banner */}
      <div className={`border-4 border-black p-6 mb-12 shadow-[8px_8px_0px_0px_#000] flex justify-between items-center
        ${job.status === 'QUEUED' ? 'bg-[#ffb000]' : ''}
        ${job.status === 'PROCESSING' ? 'bg-[#ff90e8]' : ''}
        ${job.status === 'COMPLETED' ? 'bg-[#14b8a6]' : ''}
        ${job.status === 'FAILED' ? 'bg-red-500 text-white' : ''}
      `}>
        <h2 className="text-3xl font-black uppercase tracking-tight">Status: {job.status}</h2>
        {(job.status === 'QUEUED' || job.status === 'PROCESSING') && (
          <span className="font-bold text-lg bg-black text-white px-3 py-1 animate-pulse">POLLING DB...</span>
        )}
      </div>
      
      {job.status === "FAILED" && (
        <p className="bg-white text-black border-4 border-black p-6 font-bold shadow-[6px_6px_0px_0px_#000]">
          ERROR: {job.error}
        </p>
      )}
      
      {job.status === "COMPLETED" && job.output && (
        <div className="space-y-12">
          
          {/* Summary Box */}
          <div className="bg-[#ffe900] p-6 border-4 border-black shadow-[6px_6px_0px_0px_#000]">
            <div className="bg-black text-white text-sm font-bold inline-block px-3 py-1 mb-4">SUMMARY</div>
            <p className="text-xl font-bold">{job.output.summary}</p>
          </div>

          {/* Action Items */}
          <div>
            <h3 className="font-black text-3xl mb-6 bg-white inline-block px-4 py-2 border-4 border-black shadow-[4px_4px_0px_0px_#000]">Action Items</h3>
            <div className="grid gap-6">
              {job.output.actionItems.map((item, idx) => (
                <div key={idx} className="bg-white p-6 border-4 border-black shadow-[6px_6px_0px_0px_#000] flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div>
                    <h4 className="font-black text-xl mb-2">{item.title}</h4>
                    <p className="font-medium text-gray-800">{item.description}</p>
                  </div>
                  <span className={`whitespace-nowrap font-black border-4 border-black px-3 py-1 shadow-[4px_4px_0px_0px_#000] uppercase
                    ${item.priority === 'HIGH' ? 'bg-[#ff90e8]' : 
                      item.priority === 'MEDIUM' ? 'bg-[#00f0ff]' : 
                      'bg-[#14b8a6]'}
                  `}>
                    {item.priority}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Next Steps */}
          <div>
            <h3 className="font-black text-3xl mb-6 bg-white inline-block px-4 py-2 border-4 border-black shadow-[4px_4px_0px_0px_#000]">Next Steps</h3>
            <ul className="bg-[#b19cd9] border-4 border-black shadow-[8px_8px_0px_0px_#000] p-8 space-y-4">
              {job.output.nextSteps.map((step, idx) => (
                <li key={idx} className="flex gap-4 items-start font-bold text-lg">
                  <span className="bg-black text-white px-2 py-0.5 border-2 border-black">{idx + 1}</span>
                  {step}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </main>
  );
}