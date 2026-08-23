'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Feather, Settings, Sun, Moon, FileText, Languages } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApp } from '@/lib/app-state';
import { Button } from '@/components/ui/button';

export function SiteHeader({ story }: { story?: { title?: string } }) {
  const pathname = usePathname();
  const { theme, setTheme, lang, setLang, t } = useApp();

  const cycleTheme = () => {
    const order = ['paper', 'light', 'dark'] as const;
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
  };

  const themeIcon =
    theme === 'dark' ? <Moon className="h-4 w-4" /> : theme === 'light' ? <Sun className="h-4 w-4" /> : <FileText className="h-4 w-4" />;

  return (
    <header className="flex items-center justify-between border-b px-4 h-12 shrink-0 bg-background/95 backdrop-blur">
      <div className="flex items-center gap-2">
        <Link href="/stories" className="flex items-center gap-2 text-sm font-semibold">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-primary text-primary-foreground">
            <Feather className="h-3.5 w-3.5" />
          </span>
          <span className="font-serif">{t('app.name')}</span>
        </Link>
        {story?.title ? (
          <span className="ms-3 hidden text-sm text-muted-foreground sm:inline">
            <span className="text-muted-foreground/50">/</span> {story.title}
          </span>
        ) : null}
      </div>
      <nav className="flex items-center gap-1">
        <Link
          href="/stories"
          className={cn(
            'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground',
            pathname === '/stories' && 'text-foreground',
          )}
        >
          {t('nav.stories')}
        </Link>
        <Link
          href="/settings"
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground',
            pathname === '/settings' && 'text-foreground',
          )}
        >
          <Settings className="h-3.5 w-3.5" /> {t('nav.settings')}
        </Link>
        <Button size="icon" variant="ghost" className="h-8 w-8" title={t('theme.label')} onClick={cycleTheme}>
          {themeIcon}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          title={t('lang.label')}
          onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')}
        >
          <Languages className="h-4 w-4" />
        </Button>
      </nav>
    </header>
  );
}
