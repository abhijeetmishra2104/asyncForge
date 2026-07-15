"use client";

import { useRouter } from "next/navigation";

export default function LandingPage() {
  const router = useRouter();

  return (
    <main className="max-w-5xl mx-auto p-8 space-y-16 mt-8">
      
      {/* Hero Section */}
      <section className="space-y-6 text-center max-w-4xl mx-auto">
        <h1 className="text-6xl md:text-7xl font-black tracking-tighter leading-tight">
          Where AI workloads <br />
          <span className="bg-[#ffe900] px-4 border-4 border-black inline-block shadow-[6px_6px_0px_0px_#000] -rotate-1 mt-2">
            actually finish.
          </span>
        </h1>
        <p className="text-xl font-medium max-w-2xl mx-auto mt-6">
          No timeouts. No dropped connections. Just a fault-tolerant, asynchronous distributed pipeline for heavy LLM operations.
        </p>
      </section>

      {/* Problem & Solution Split */}
      <section className="grid md:grid-cols-2 gap-8">
        <div className="bg-[#ff90e8] border-4 border-black p-8 shadow-[8px_8px_0px_0px_#000]">
          <div className="bg-black text-white text-sm font-bold inline-block px-3 py-1 mb-4">THE PROBLEM</div>
          <h2 className="text-3xl font-black mb-4">Synchronous HTTP Kills AI.</h2>
          <p className="font-medium text-lg leading-relaxed">
            When you build vehicle damage detection pipelines or advanced reasoning agents, LLMs take 10-30 seconds to respond. Standard HTTP requests time out, the connection dies, and the user gets a generic 500 error while the job is lost forever.
          </p>
        </div>

        <div className="bg-[#00f0ff] border-4 border-black p-8 shadow-[8px_8px_0px_0px_#000]">
          <div className="bg-black text-white text-sm font-bold inline-block px-3 py-1 mb-4">THE SOLUTION</div>
          <h2 className="text-3xl font-black mb-4">Decouple the Workload.</h2>
          <p className="font-medium text-lg leading-relaxed">
            We return a <span className="bg-white px-2 py-0.5 border-2 border-black">202 Accepted</span> instantly. The task is durably saved to PostgreSQL and dispatched to a RabbitMQ queue. Independent workers pick up the job, process the AI request, and save the result.
          </p>
        </div>
      </section>

      {/* Architecture Flow */}
      <section className="space-y-6">
        <h2 className="text-3xl font-black flex items-center gap-3">
          <span className="text-2xl">⚙️</span> Architecture Flow
        </h2>
        <div className="grid md:grid-cols-4 gap-4 text-center">
          <div className="bg-[#14b8a6] border-4 border-black p-4 shadow-[4px_4px_0px_0px_#000] font-bold text-lg">
            1. Web API <br/><span className="text-sm font-normal">HTTP 202 + Outbox</span>
          </div>
          <div className="bg-[#ffb000] border-4 border-black p-4 shadow-[4px_4px_0px_0px_#000] font-bold text-lg">
            2. Dispatcher <br/><span className="text-sm font-normal">RabbitMQ Publish</span>
          </div>
          <div className="bg-[#b19cd9] border-4 border-black p-4 shadow-[4px_4px_0px_0px_#000] font-bold text-lg">
            3. Worker <br/><span className="text-sm font-normal">Groq AI Processing</span>
          </div>
          <div className="bg-[#ffe900] border-4 border-black p-4 shadow-[4px_4px_0px_0px_#000] font-bold text-lg">
            4. PostgreSQL <br/><span className="text-sm font-normal">Durable Completion</span>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-white border-4 border-black p-12 shadow-[12px_12px_0px_0px_#000] text-center space-y-6">
        <h2 className="text-4xl font-black">See it in action.</h2>
        <p className="text-xl font-medium">Test the end-to-end message queue and AI processing pipeline.</p>
        <button 
          onClick={() => router.push('/demo')}
          className="bg-black text-white border-4 border-black font-black text-xl px-12 py-4 shadow-[6px_6px_0px_0px_#ffe900] hover:-translate-y-1 hover:shadow-[10px_10px_0px_0px_#ffe900] active:translate-y-1 active:shadow-[2px_2px_0px_0px_#ffe900] transition-all"
        >
          START DEMO →
        </button>
      </section>

    </main>
  );
}