import type { Metadata } from "next";
import { Inter, Inter_Tight, Instrument_Serif } from "next/font/google";
import Nav from "@/components/Nav";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-body" });
const interTight = Inter_Tight({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-display" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif" });

export const metadata: Metadata = {
  title: "AI Movie Director: type a scene, watch it become a movie",
  description:
    "Turn your words and photos into a cinematic film that plays live, and direct what happens next by typing or speaking.",
  openGraph: {
    title: "AI Movie Director",
    description: "Type a scene. Watch it become a movie, live.",
    images: ["/media/harbor.jpg"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${interTight.variable} ${serif.variable}`}>
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
