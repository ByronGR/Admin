import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Inter, Roboto } from "next/font/google";
import { cn } from "@/lib/utils";

const robotoHeading = Roboto({subsets:['latin'],variable:'--font-heading'});

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'Nearwork Admin',
  description: 'Nearwork internal admin dashboard',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" className={cn("font-sans", inter.variable, robotoHeading.variable)}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
