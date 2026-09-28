import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LoadForge // ASG Control",
  description: "Real-time auto scaling dashboard: EC2 capacity, CPU, traffic and scaling events.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jetbrains.variable} h-full antialiased`}>
      <body className="bg-grid scanlines min-h-full">{children}</body>
    </html>
  );
}
