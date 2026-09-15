import type { Metadata } from "next";
import "./globals.css";

// Next picks up app/icon.svg, apple-icon.png, opengraph-image.png and
// twitter-image.png by filename. metadataBase is what turns those into the
// absolute URLs that link previews require.
export const metadata: Metadata = {
  metadataBase: new URL("https://app.asyncforge.me"),
  title: "AsyncForge",
  description:
    "A fault-tolerant, horizontally scalable asynchronous AI task processing system. Accept fast, queue reliably, process asynchronously, recover from failure.",
  openGraph: {
    title: "AsyncForge",
    description: "Where AI workloads actually finish.",
    url: "https://app.asyncforge.me",
    siteName: "AsyncForge",
    type: "website",
  },
};

/** The anvil mark. Inline so it needs no request and inherits no font. */
function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label="AsyncForge" className={className}>
      <path d="M4 22 H60 V32 H46 L43 44 H52 V54 H12 V44 H21 L18 32 H4 Z" fill="#000000" />
      <path
        d="M50 4 L53 12 L61 15 L53 18 L50 26 L47 18 L39 15 L47 12 Z"
        fill="#ffe900"
        stroke="#000000"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen flex flex-col">
        <nav className="border-b-4 border-black bg-white px-8 py-4 flex justify-between items-center">
          <a href="/" className="flex items-center gap-3 text-2xl font-black tracking-tight">
            <Logo className="w-9 h-9 shrink-0" />
            ASYNC.FORGE
          </a>
          <a
            href="/demo"
            className="bg-[#ffe900] border-2 border-black font-bold px-4 py-1 shadow-[3px_3px_0px_0px_#000] hover:-translate-y-0.5 hover:shadow-[5px_5px_0px_0px_#000] active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_#000] transition-all"
          >
            Try Demo
          </a>
        </nav>

        <div className="flex-grow">
          {children}
        </div>

        <footer className="border-t-4 border-black bg-white p-6 mt-12 flex flex-col items-center gap-2 font-bold">
          <Logo className="w-7 h-7" />
          <p>&copy; {new Date().getFullYear()} Built by Abhijeet Mishra. All rights reserved.</p>
        </footer>
      </body>
    </html>
  );
}
