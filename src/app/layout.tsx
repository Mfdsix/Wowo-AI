import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "wowo.ai",
  description: "Your personal AI chat",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full">{children}</body>
    </html>
  );
}
