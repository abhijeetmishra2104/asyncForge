"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DemoPage() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });

    if (res.ok) {
      const data = await res.json();
      router.push(`/jobs/${data.jobId}`);
    } else {
      alert("Failed to submit task");
      setLoading(false);
    }
  };

  return (
    <main className="max-w-3xl mx-auto p-8 mt-12">
      
      <div className="mb-10 text-center">
        <h1 className="text-5xl font-black mb-4 uppercase tracking-tight">Submit AI Task</h1>
        <div className="bg-white border-4 border-black p-4 shadow-[6px_6px_0px_0px_#000] inline-block font-bold">
          <span className="text-[#14b8a6]">Accepted</span> ➔ <span className="text-[#ffb000]">Queued</span> ➔ <span className="text-[#ff90e8]">Processing</span> ➔ <span className="text-[#b19cd9]">Completed</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border-4 border-black p-8 shadow-[12px_12px_0px_0px_#000] space-y-6">
        <div>
          <label className="block font-black text-xl mb-2">Prompt (Min 10 characters)</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full p-4 border-4 border-black bg-[#fffdf7] text-lg font-medium shadow-[4px_4px_0px_0px_#000] focus:outline-none focus:bg-white focus:shadow-[6px_6px_0px_0px_#ffe900] transition-all resize-y"
            rows={6}
            placeholder="e.g., Plan the backend architecture for a highly concurrent competitive programming platform..."
            required
            minLength={10}
          />
        </div>
        
        <button
          type="submit"
          disabled={loading || prompt.length < 10}
          className="w-full bg-[#14b8a6] text-black border-4 border-black font-black text-2xl px-6 py-4 shadow-[6px_6px_0px_0px_#000] hover:-translate-y-1 hover:shadow-[10px_10px_0px_0px_#000] active:translate-y-1 active:shadow-[2px_2px_0px_0px_#000] disabled:opacity-50 disabled:cursor-not-allowed transition-all uppercase tracking-wide"
        >
          {loading ? "Forging Task..." : "Execute"}
        </button>
      </form>
    </main>
  );
}