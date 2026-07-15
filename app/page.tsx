"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
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
    <main className="max-w-3xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-4">AsyncForge</h1>
      <p className="text-gray-600 mb-8">
        Fault-Tolerant Distributed AI Task Processing System. Decoupling HTTP requests from heavy AI workloads.
      </p>
      
      <div className="bg-gray-100 p-4 rounded-md mb-8 text-sm text-gray-700 flex items-center justify-between">
        <span>Accepted</span> ➔ <span>Queued</span> ➔ <span>Processing</span> ➔ <span>Completed</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full p-4 border rounded-md shadow-sm focus:ring-2 focus:ring-blue-500"
          rows={5}
          placeholder="e.g., Plan the backend architecture for a scalable notification system..."
          required
          minLength={10}
        />
        <button
          type="submit"
          disabled={loading || prompt.length < 10}
          className="bg-blue-600 text-white px-6 py-2 rounded-md disabled:bg-blue-300 transition-colors"
        >
          {loading ? "Submitting..." : "Submit AI Task"}
        </button>
      </form>
    </main>
  );
}