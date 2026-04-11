import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SmartLearn Web",
  description: "Frontend web de SmartLearn",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
