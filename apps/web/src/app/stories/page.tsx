'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookOpen, Copy, Plus, Share2, Trash2 } from 'lucide-react';
import type { StorySummary } from '@storywriter/types';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { useDialogs } from '@/lib/dialogs';
import { formatRelative } from '@/lib/utils';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export default function StoriesPage() {
  const router = useRouter();
  const { t, lang } = useApp();
  const dialogs = useDialogs();
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStories(await api.listStories());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(id: string) {
    const ok = await dialogs.confirm({
      title: t('dash.action.delete'),
      message: t('dash.confirm.delete'),
      okLabel: t('dash.action.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteStory(id);
      load();
    } catch (err) {
      dialogs.notify({ message: err instanceof Error ? err.message : 'Delete failed' });
    }
  }

  async function handleDuplicate(id: string) {
    try {
      await api.duplicateStory(id);
      load();
    } catch (err) {
      dialogs.notify({ message: err instanceof Error ? err.message : 'Duplicate failed' });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <SiteHeader />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="font-serif text-2xl font-semibold">{t('dash.title')}</h1>
              <p className="text-sm text-muted-foreground">{t('dash.subtitle')}</p>
            </div>
            <Button onClick={() => router.push('/stories/new')}>
              <Plus className="h-4 w-4" /> {t('dash.new')}
            </Button>
          </div>

          {error ? (
            <ErrorState title={t('err.load')} message={error} onRetry={load} />
          ) : loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
            </div>
          ) : stories.length === 0 ? (
            <Card className="py-14 text-center">
              <CardContent>
                <BookOpen className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{t('dash.empty.subtitle')}</p>
                <Button className="mt-4" onClick={() => router.push('/stories/new')}>
                  <Plus className="h-4 w-4" /> {t('dash.new')}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {stories.map((story) => (
                <Card key={story.id} className="group flex flex-col">
                  <CardHeader className="pb-2">
                    <Link href={`/stories/${story.id}`}>
                      <CardTitle className="line-clamp-1 group-hover:underline">{story.title}</CardTitle>
                    </Link>
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {story.genre ? <Badge variant="secondary">{story.genre}</Badge> : null}
                      <Badge variant="outline">{t('dash.nodes', { n: story.nodeCount })}</Badge>
                      <Badge variant="outline">{t('dash.branches', { n: story.branchCount })}</Badge>
                      <Badge variant="outline">{t('dash.chapters', { n: story.chapterCount })}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1">
                    {story.description ? (
                      <p className="line-clamp-2 text-sm text-muted-foreground">{story.description}</p>
                    ) : null}
                  </CardContent>
                  <div className="flex items-center justify-between gap-1 border-t px-4 py-2.5">
                    <span className="text-xs text-muted-foreground">
                      {t('dash.updated', { time: formatRelative(story.updatedAt, lang) })}
                    </span>
                    <div className="flex gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => router.push(`/stories/${story.id}/graph`)}>
                            <Share2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('dash.action.graph')}</TooltipContent>
                      </Tooltip>
                      <Button size="icon" variant="ghost" className="h-8 w-8" title={t('dash.action.duplicate')} onClick={() => handleDuplicate(story.id)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" title={t('dash.action.delete')} onClick={() => handleDelete(story.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
