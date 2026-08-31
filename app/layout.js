import { Geist } from "next/font/google";
import "./globals.css";
import { Kopfleiste, Fussleiste } from "./_ui/Rahmen";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata = {
  title: "KBeyond",
  description:
    "Kickbase-Liga-Analyse: Kontostände, Liquidität und maximale Gebotshöhe aller Manager einer Liga.",
};

// Ohne diesen Export fehlt das Viewport-Meta und Handys rendern die Seite
// in 980px Breite und zoomen heraus – dann hilft auch kein Breakpoint.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
};

export default function RootLayout({ children }) {
  return (
    <html lang="de" className={geistSans.variable}>
      <body>
        <Kopfleiste />
        {children}
        <Fussleiste />
      </body>
    </html>
  );
}
