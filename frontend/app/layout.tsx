import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = new URL(`${protocol}://${host}`);
  const description = "Responsive frontend CRM for companies, contacts, tasks, and role-based workflows.";

  return {
    metadataBase: baseUrl,
    title: "Client Data CRM",
    description,
    openGraph: {
      title: "Client Data",
      description,
      type: "website",
      images: [{ url: new URL("/og.png", baseUrl).toString(), width: 1732, height: 916, alt: "Client Data CRM workspace" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Client Data",
      description,
      images: [new URL("/og.png", baseUrl).toString()],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
