import type { Metadata } from 'next';
import { Inter, Newsreader, Vazirmatn } from 'next/font/google';
import { AppProviders } from '@/lib/app-state';
import { DialogsProvider } from '@/lib/dialogs';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const newsreader = Newsreader({ subsets: ['latin'], variable: '--font-serif', style: ['normal', 'italic'] });
const vazirmatn = Vazirmatn({ subsets: ['arabic', 'latin'], variable: '--font-fa' });

export const metadata: Metadata = {
  title: 'Storywriter',
  description: 'An AI co-author for branching, persistent interactive stories.',
};

// Apply saved theme/language before first paint to avoid a flash of the wrong
// appearance. Mirrors what AppProviders does on the client.
const bootstrap = `(function(){try{var t=window.localStorage.getItem('sw-theme')||'paper';var l=window.localStorage.getItem('sw-lang')||'en';var d=document.documentElement;d.className=(t==='dark'?'dark':t==='light'?'light':'paper');d.setAttribute('lang',l);d.dir=(l==='fa'?'rtl':'ltr');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootstrap }} />
      </head>
      <body
        className={`${inter.variable} ${newsreader.variable} ${vazirmatn.variable} font-sans h-screen overflow-hidden`}
      >
        <AppProviders>
          <DialogsProvider>{children}</DialogsProvider>
        </AppProviders>
      </body>
    </html>
  );
}
