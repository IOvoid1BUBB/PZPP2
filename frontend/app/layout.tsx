import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";

import "@/globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "LoadMax — Planning lab",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl">
      <body className={plusJakartaSans.className}>{children}</body>
    </html> 
  );
}
