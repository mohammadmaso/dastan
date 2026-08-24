'use client';

import { useState } from 'react';
import { Brain, CheckCircle, ChevronDown, ChevronRight, Search, TriangleAlert } from 'lucide-react';
import type { RetrievalStep } from '@storywriter/types';
import { useApp } from '@/lib/app-state';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface Props {
  steps: RetrievalStep[];
  streaming: boolean;
  activity?: string;
}

export function AgentTrace({ steps, streaming, activity }: Props) {
  const { t } = useApp();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
        <Brain className="h-3.5 w-3.5" />
        {t('act.title')}
        {streaming ? <Badge variant="secondary">{t('act.working')}</Badge> : null}
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3">
          {activity ? <p className="text-xs text-muted-foreground">{activity}</p> : null}
          {steps.length === 0 && !streaming ? (
            <p className="text-xs text-muted-foreground">{t('act.empty')}</p>
          ) : null}
          {steps.map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function StepRow({ step }: { step: RetrievalStep }) {
  const [open, setOpen] = useState(false);
  const Icon =
    step.status === 'error'
      ? TriangleAlert
      : step.status === 'found'
        ? CheckCircle
        : step.tool === 'look_up_entity'
          ? Brain
          : Search;
  const facts = step.facts ?? [];
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-start text-xs hover:bg-accent">
        <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', step.status === 'searching' && 'animate-pulse')} />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{step.tool === 'look_up_entity' ? 'entity' : 'search'}</span>
          {': '}
          <span className="text-muted-foreground" dir="auto">
            “{step.query}”
          </span>
          {step.scope ? <span className="ms-1 text-muted-foreground">({scopeLabel(step.scope)})</span> : null}
          {step.status === 'found' ? <span className="ms-1">{facts.length} facts</span> : null}
        </span>
        {facts.length ? (open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />) : null}
      </CollapsibleTrigger>
      {facts.length ? (
        <CollapsibleContent>
          <ul className="ms-6 mt-1 list-disc space-y-1 text-[11px] text-muted-foreground">
            {facts.map((f, i) => (
              <li key={i} dir="auto">
                {f}
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

function scopeLabel(scope: string) {
  if (scope === 'GLOBAL_STORY_MEMORY') return 'world';
  if (scope === 'CURRENT_BRANCH_MEMORY') return 'this branch';
  return scope;
}
