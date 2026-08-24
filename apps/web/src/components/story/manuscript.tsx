'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, GitFork, Pencil, Trash2, BookMarked, User } from 'lucide-react';
import type { StoryNode, StoryPreferenceVersion } from '@storywriter/types';
import { cn, countWords } from '@/lib/utils';
import { useApp } from '@/lib/app-state';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  path: StoryNode[];
  selectedId: string | null;
  editingId: string | null;
  draft: string;
  saveState: 'idle' | 'saving' | 'saved';
  streaming: boolean;
  streamText: string;
  prefHistory: StoryPreferenceVersion[];
  onSelect: (node: StoryNode) => void;
  onStartEdit: (node: StoryNode) => void;
  onDraftChange: (v: string) => void;
  onStopEdit: () => void;
  onChapter: (node: StoryNode) => void;
  onBranch: (node: StoryNode) => void;
  onDelete: (node: StoryNode) => void;
}

export function Manuscript({
  path,
  selectedId,
  editingId,
  draft,
  saveState,
  streaming,
  streamText,
  prefHistory,
  onSelect,
  onStartEdit,
  onDraftChange,
  onStopEdit,
  onChapter,
  onBranch,
  onDelete,
}: Props) {
  const { t } = useApp();
  const readable = path.filter((n) => n.nodeType !== 'ROOT' || n.content.trim());
  let prevChapter: string | null = null;
  let lastPrefAt = prefHistory[0]?.createdAt ?? null;

  return (
    <article className="mx-auto max-w-[42rem] px-6 py-10">
      {readable.length === 0 && !streaming ? (
        <p className="text-center text-sm text-muted-foreground">{t('ms.empty')}</p>
      ) : null}

      {readable.map((node) => {
        const chapterStart = node.chapterTitle && node.chapterTitle !== prevChapter;
        const chapterTitle = chapterStart ? node.chapterTitle : null;
        prevChapter = node.chapterTitle ?? prevChapter;

        const prefNote = prefHistory.find(
          (p) =>
            lastPrefAt &&
            p.createdAt > lastPrefAt &&
            p.createdAt <= node.createdAt &&
            p.note,
        );
        if (prefNote) lastPrefAt = prefNote.createdAt;

        const words = countWords(node.content);
        return (
          <div key={node.id}>
            {chapterStart ? (
              <div className="my-10 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <h2 className="font-serif text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {chapterTitle}
                </h2>
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            {prefNote?.note ? (
              <p className="mb-4 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground">
                {t('ms.prefChange', { note: prefNote.note, v: prefNote.version })}
              </p>
            ) : null}
            <NodeBlock
              node={node}
              selected={selectedId === node.id}
              editing={editingId === node.id}
              draft={editingId === node.id ? draft : node.content}
              saveState={editingId === node.id ? saveState : 'idle'}
              words={words}
              onSelect={() => onSelect(node)}
              onStartEdit={() => onStartEdit(node)}
              onDraftChange={onDraftChange}
              onStopEdit={onStopEdit}
              onChapter={() => onChapter(node)}
              onBranch={() => onBranch(node)}
              onDelete={() => onDelete(node)}
            />
          </div>
        );
      })}

      {streaming ? (
        <div className="mt-6 font-serif text-[17px] leading-8">
          <span dir="auto" className="whitespace-pre-wrap">
            {streamText}
          </span>
          <span className="ms-0.5 inline-block h-5 w-0.5 animate-pulse bg-primary align-middle" />
        </div>
      ) : null}
    </article>
  );
}

function NodeBlock({
  node,
  selected,
  editing,
  draft,
  saveState,
  words,
  onSelect,
  onStartEdit,
  onDraftChange,
  onStopEdit,
  onChapter,
  onBranch,
  onDelete,
}: {
  node: StoryNode;
  selected: boolean;
  editing: boolean;
  draft: string;
  saveState: 'idle' | 'saving' | 'saved';
  words: number;
  onSelect: () => void;
  onStartEdit: () => void;
  onDraftChange: (v: string) => void;
  onStopEdit: () => void;
  onChapter: () => void;
  onBranch: () => void;
  onDelete: () => void;
}) {
  const { t } = useApp();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.style.height = 'auto';
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [editing, draft]);

  if (editing) {
    return (
      <div className="relative mb-6 rounded-md border border-primary/40 bg-card/40 p-3">
        <Textarea
          ref={ref}
          dir="auto"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={onStopEdit}
          className="min-h-[8rem] resize-none border-0 bg-transparent p-0 font-serif text-[17px] leading-8 shadow-none focus-visible:ring-0"
        />
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {saveState === 'saving' ? t('ne.saving') : saveState === 'saved' ? t('ne.saved') : t('ne.footer')}
          </span>
          <span>{t('ms.words', { n: countWords(draft) })}</span>
        </div>
      </div>
    );
  }

  return (
    <section
      className={cn(
        'group relative mb-6 rounded-md px-1 py-1 transition-colors',
        selected && 'bg-accent/40',
      )}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onSelect}
    >
      {(hover || selected) && (
        <div className="absolute -top-3 end-0 z-10 flex items-center gap-0.5 rounded-md border bg-background/95 px-1 py-0.5 shadow-sm">
          <RailBtn label={t('ne.edit')} onClick={onStartEdit}>
            <Pencil className="h-3 w-3" />
          </RailBtn>
          <RailBtn label={t('ne.chapter')} onClick={onChapter}>
            <BookMarked className="h-3 w-3" />
          </RailBtn>
          <RailBtn label={t('ne.branch')} onClick={onBranch}>
            <GitFork className="h-3 w-3" />
          </RailBtn>
          <RailBtn label={t('bm.delete')} onClick={onDelete}>
            <Trash2 className="h-3 w-3 text-destructive" />
          </RailBtn>
        </div>
      )}
      <p className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {node.author === 'ai' ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
        {node.continuationLabel ? <span dir="auto">{node.continuationLabel}</span> : null}
        <span className="ms-auto">{t('ms.words', { n: words })}</span>
      </p>
      <p dir="auto" className="whitespace-pre-wrap font-serif text-[17px] leading-8">
        {node.content}
      </p>
    </section>
  );
}

function RailBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
