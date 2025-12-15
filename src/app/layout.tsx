import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NetSim Web - Interactive Network Simulator",
  description: "A premium, vendor-agnostic network simulator with realistic networking, drag-and-drop topology design, and UNIX-like terminal configuration.",
  keywords: ["network simulator", "topology", "networking", "education", "cisco", "router", "switch"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-dark-950 text-white antialiased">
        {children}
      </body>
    </html>
  );
}
