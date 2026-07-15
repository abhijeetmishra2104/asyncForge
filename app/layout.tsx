import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen flex flex-col">
        <nav className="border-b-4 border-black bg-white px-8 py-4 flex justify-between items-center">
          <a href="/" className="text-2xl font-black tracking-tight">ASYNC.FORGE</a>
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

        <footer className="border-t-4 border-black bg-white p-6 mt-12 text-center font-bold">
          <p>Built with ☕️ by Abhijeet Mishra</p>
        </footer>
      </body>
    </html>
  );
}