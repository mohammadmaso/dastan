'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BookMarked, Check, Loader2, Waypoints, X } from 'lucide-react';
import type { ContinuationOption, StoryNode } from '@storywriter/types';
import { useApp } from '@/lib/app-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Continuations } from './continuations';

interface Props {
  node: StoryNode;
  draft: string;
  onDraftChange: (v: string) => void;
  saveState: 'idle' | 'saving' | 'saved';
  streaming: boolean;
  options: ContinuationOption[];
  branchName: string;
  onClose: () => void;
  onChoose: (o: ContinuationOption) => void;
  onMore: () => void;
  onCustom: (text: string) => void;
  onBranchFromOption: (o: ContinuationOption) => void;
  onBranch: () => void;
  onSetChapter: () => void;
}

export function NodeModal({
  node,
  draft,
  onDraftChange,
  saveState,
  streaming,
  options,
  branchName,
  onClose,
  onChoose,
  onMore,
  onCustom,
  onBranchFromOption,
  onBranch,
  onSetChapter,
}: Props) {
  const { t } = useApp();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isStart = node.nodeType === 'ROOT';

  return createPortal(
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-serif text-lg font-semibold leading-tight">
              {node.chapterTitle ??
                node.continuationLabel ??
                (isStart ? t('ne.rootPlaceholder') : branchName || t('ne.branch'))}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant={node.author === 'ai' ? 'accent' : 'secondary'}>
                {node.author === 'ai' ? t('ne.authorAi') : node.author === 'user' ? t('ne.authorUser') : t('ne.authorSystem')}
              </Badge>
              {node.isCurrent ? <Badge>{t('ne.current')}</Badge> : null}
              {node.chapterTitle ? <Badge variant="outline">📖 {node.chapterTitle}</Badge> : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
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
            <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {streaming ? (
            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> {t('ne.writing')}
              </div>
              <div className="whitespace-pre-wrap font-serif text-[16px] leading-7 text-foreground/90">
                {draft}
                <span className="ms-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary align-middle" />
              </div>
            </div>
          ) : (
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              placeholder={isStart ? t('ne.rootPlaceholder') : t('ne.editPlaceholder')}
              className="min-h-[160px] w-full resize-y rounded-lg border bg-background p-4 font-serif text-[16px] leading-7 text-foreground/90 outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:text-muted-foreground/50"
            />
          )}

          {/* next-step suggestions */}
          <Continuations
            options={options}
            onChoose={onChoose}
            onMore={onMore}
            onCustom={onCustom}
            onBranchFromOption={onBranchFromOption}
            busy={streaming}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
