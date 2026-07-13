import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { AuthProvider } from '@/lib/auth';
import { SWRProvider } from '@/components/swr-provider';
import { Toaster } from '@/components/ui/toaster';
import './globals.css';

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'OrgAI',
  description: 'Org-wide AI compliance platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Apply persisted theme before paint — no flash. Defaults to light. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.theme==='dark'){document.documentElement.classList.add('dark')}}catch(e){}`,
          }}
        />
      </head>
      <body className="font-sans min-h-screen bg-background antialiased">
        <SWRProvider>
          <AuthProvider>
            {children}
            <Toaster />
          </AuthProvider>
        </SWRProvider>
      </body>
    </html>
  );
}
