'use client';

import { Bot, GitFork, User } from 'lucide-react';
import type { Branch, StoryNode } from '@storywriter/types';
import { useApp } from '@/lib/app-state';
import { childrenOf, colorFor, tipOfBranch, walkPath } from '@/lib/story-path';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

interface Props {
  nodes: StoryNode[];
  branches: Branch[];
  activeBranchId: string;
  selectedNodeId: string | null;
  onSelect: (node: StoryNode) => void;
  onFocusBranch: (branchId: string) => void;
}

export function StoryTree({ nodes, branches, activeBranchId, selectedNodeId, onSelect, onFocusBranch }: Props) {
  const { t } = useApp();
  const tip = tipOfBranch(nodes, activeBranchId);
  const path = walkPath(nodes, tip);

  if (!path.length) {
    return <p className="p-3 text-xs text-muted-foreground">{t('tree.empty')}</p>;
  }

  return (
    <ScrollArea className="h-full">
      <ol className="space-y-1 px-3 py-3">
        {path.map((node, i) => {
          const alts = childrenOf(nodes, node.id).filter((c) => c.branchId !== activeBranchId && !path.some((p) => p.id === c.id));
          const selected = selectedNodeId === node.id;
          const isTip = tip?.id === node.id;
          return (
            <li key={node.id} className="relative">
              {i > 0 ? <div className="absolute -top-1 start-[11px] h-2 w-px bg-border" /> : null}
              <button
                type="button"
                onClick={() => onSelect(node)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-start text-xs transition-colors',
                  selected ? 'border-primary bg-primary/10' : 'border-transparent hover:border-border hover:bg-accent',
                )}
              >
                <span
                  className="mt-1 h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colorFor(node.branchId) }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1">
                    {node.author === 'ai' ? <Bot className="h-3 w-3 text-muted-foreground" /> : <User className="h-3 w-3 text-muted-foreground" />}
                    <span dir="auto" className="truncate">
                      {preview(node)}
                    </span>
                  </span>
                  {node.continuationLabel ? (
                    <span dir="auto" className="block truncate text-[11px] text-muted-foreground">
                      {node.continuationLabel}
                    </span>
                  ) : null}
                </span>
                {isTip ? (
                  <Badge className="h-4 px-1 text-[9px]">{t('ne.current')}</Badge>
                ) : null}
              </button>
              {alts.length > 0 ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="ghost" className="ms-5 mt-0.5 h-6 gap-1 px-1.5 text-[11px]">
                      <GitFork className="h-3 w-3" />
                      {t('tree.alts', { n: alts.length })}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-2" align="start">
                    <p className="mb-1 text-[11px] font-medium text-muted-foreground">{t('tree.altsTitle')}</p>
                    <div className="space-y-1">
                      {alts.map((alt) => {
                        const b = branches.find((x) => x.id === alt.branchId);
                        return (
                          <button
                            key={alt.id}
                            type="button"
                            className="flex w-full flex-col rounded-md border px-2 py-1.5 text-start text-xs hover:bg-accent"
                            onClick={() => onFocusBranch(alt.branchId)}
                          >
                            <span className="font-medium">{b?.name ?? t('tree.unnamed')}</span>
                            <span className="truncate text-muted-foreground" dir="auto">
                              {preview(alt)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              ) : null}
            </li>
          );
        })}
      </ol>
    </ScrollArea>
  );
}

function preview(node: StoryNode): string {
  const t = node.content.replace(/\s+/g, ' ').trim();
  return t.length > 72 ? `${t.slice(0, 72)}…` : t || '(empty)';
}
