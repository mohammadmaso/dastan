'use client';

import { useRouter } from 'next/navigation';
import type { Branch, StoryNode } from '@storywriter/types';
import { useApp } from '@/lib/app-state';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  storyId: string;
  nodes: StoryNode[];
  branches: Branch[];
  onSelectNode: (n: StoryNode) => void;
  onSwitchBranch: (b: Branch) => void;
  onExport?: () => void;
}

export function StoryCommandPalette({
  open,
  onOpenChange,
  storyId,
  nodes,
  branches,
  onSelectNode,
  onSwitchBranch,
  onExport,
}: Props) {
  const { t } = useApp();
  const router = useRouter();
  const chapters = nodes.filter((n, i, arr) => n.chapterTitle && arr.findIndex((x) => x.chapterTitle === n.chapterTitle) === i);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder={t('cmd.placeholder')} />
      <CommandList>
        <CommandEmpty>{t('cmd.empty')}</CommandEmpty>
        <CommandGroup heading={t('cmd.goto')}>
          {chapters.map((n) => (
            <CommandItem
              key={`ch-${n.id}`}
              onSelect={() => {
                onSelectNode(n);
                onOpenChange(false);
              }}
            >
              {n.chapterTitle}
            </CommandItem>
          ))}
          {branches.map((b) => (
            <CommandItem
              key={b.id}
              onSelect={() => {
                onSwitchBranch(b);
                onOpenChange(false);
              }}
            >
              {b.name}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={t('cmd.actions')}>
          <CommandItem
            onSelect={() => {
              onExport?.();
              onOpenChange(false);
            }}
          >
            {t('ws.export')}
          </CommandItem>
          <CommandItem
            onSelect={() => {
              router.push('/settings');
              onOpenChange(false);
            }}
          >
            {t('nav.settings')}
          </CommandItem>
          <CommandItem
            onSelect={() => {
              router.push(`/stories/${storyId}/graph`);
              onOpenChange(false);
            }}
          >
            {t('dash.action.graph')}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
