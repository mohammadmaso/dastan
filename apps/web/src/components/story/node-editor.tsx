'use client';

import { Check, CircleAlert, Loader2, Pencil, BookMarked, Waypoints } from 'lucide-react';
import type { StoryNode } from '@storywriter/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useApp } from '@/lib/app-state';

interface Props {
  node: StoryNode | null;
  draft: string;
  onDraftChange: (v: string) => void;
  streaming: boolean;
  streamText: string;
  saveState: 'idle' | 'saving' | 'saved';
  onSetChapter: () => void;
  onBranch: () => void;
}

export function NodeEditor({
  node,
  draft,
  onDraftChange,
  streaming,
  streamText,
  saveState,
  onSetChapter,
  onBranch,
}: Props) {
  const { t } = useApp();

  if (!node) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
        <p className="text-sm">{t('ne.noselect.title')}</p>
      </div>
    );
  }

  const authorLabel =
    node.author === 'ai' ? t('ne.authorAi') : node.author === 'user' ? t('ne.authorUser') : t('ne.authorSystem');

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Badge variant={node.author === 'ai' ? 'accent' : 'secondary'}>{authorLabel}</Badge>
        {node.continuationLabel ? <Badge variant="outline">{node.continuationLabel}</Badge> : null}
        {node.isCurrent ? <Badge>{t('ne.current')}</Badge> : null}
        {node.chapterTitle ? <Badge variant="outline">📖 {node.chapterTitle}</Badge> : null}
        <div className="ms-auto flex items-center gap-1">
          {saveState === 'saving' && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> {t('ne.saving')}
            </span>
          )}
          {saveState === 'saved' && (
            <span className="flex items-center gap-1 text-xs text-emerald-500">
              <Check className="h-3 w-3" /> {t('ne.saved')}
            </span>
          )}
          <Button size="sm" variant="ghost" onClick={onSetChapter} title={t('ne.chapter')}>
            <BookMarked className="h-3.5 w-3.5" /> {t('ne.chapter')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onBranch} title={t('ne.branch')}>
            <Waypoints className="h-3.5 w-3.5" /> {t('ne.branch')}
          </Button>
        </div>
      </div>

      {streaming ? (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> {t('ne.writing')}
          </div>
          <div dir="auto" className="whitespace-pre-wrap break-words text-start font-serif text-[17px] leading-7 text-foreground/90">
            {streamText}
            <span className="ms-0.5 inline-block h-5 w-0.5 animate-pulse bg-primary align-middle" />
          </div>
        </div>
      ) : (
        <textarea
          dir="auto"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={node.nodeType === 'ROOT' ? t('ne.rootPlaceholder') : t('ne.editPlaceholder')}
          className="flex-1 resize-none bg-transparent p-6 text-start font-serif text-[17px] leading-7 text-foreground/90 outline-none placeholder:text-muted-foreground/50"
        />
      )}

      <div className="flex items-center gap-1.5 border-t px-4 py-1.5 text-[11px] text-muted-foreground">
        <Pencil className="h-3 w-3" /> {t('ne.footer')}
        {node.nodeType === 'ROOT' ? (
          <span className="flex items-center gap-1 text-amber-500">
            <CircleAlert className="h-3 w-3" /> {t('ne.rootNote')}
          </span>
        ) : null}
      </div>
    </div>
  );
}
