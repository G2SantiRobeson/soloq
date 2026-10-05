import type { Metadata } from "next";
import localFont from "next/font/local";
import { Header, Footer, DemoBanner } from "@/components/shell";
import "./globals.css";
const barlow = localFont({
  src: [
    { path: "./fonts/Barlow-Regular.ttf", weight: "400" },
    { path: "./fonts/Barlow-SemiBold.ttf", weight: "600" },
  ],
  variable: "--font-body",
  display: "swap",
});
const condensed = localFont({
  src: "./fonts/BarlowCondensed-SemiBold.ttf",
  weight: "600",
  variable: "--font-display",
  display: "swap",
});
export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"),
  title: { default: "SoloQ — Cada partida cuenta", template: "%s | SoloQ" },
  description:
    "Sigue el ranking, las partidas y el progreso de tu comunidad de League of Legends. SoloQ, Flex y 5v5 en un solo lugar.",
  openGraph: {
    title: "SoloQ — Cada partida cuenta",
    description: "El ranking de tu comunidad de League of Legends.",
    type: "website",
    locale: "es_CL",
    siteName: "SoloQ",
  },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${barlow.variable} ${condensed.variable}`}>
      <body>
        <a className="skip-link" href="#content">
          Saltar al contenido
        </a>
        <Header />
        <DemoBanner />
        <main id="content" className="container main-content">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
