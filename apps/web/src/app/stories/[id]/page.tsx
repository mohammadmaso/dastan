'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, Network, SlidersHorizontal, X } from 'lucide-react';
import type {
  Branch,
  ContinuationOption,
  LLMSettings,
  RetrievalStep,
  Story,
  StoryNode,
  StoryPreferenceVersion,
} from '@storywriter/types';
import { api, streamContinue } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { useDialogs } from '@/lib/dialogs';
import { countWords } from '@/lib/utils';
import { tipOfBranch, walkPath } from '@/lib/story-path';
import { SiteHeader } from '@/components/site-header';
import { StoryTree } from '@/components/story/story-tree';
import { StoryCanvas } from '@/components/story/story-canvas';
import { Manuscript } from '@/components/story/manuscript';
import { WriteHead } from '@/components/story/write-head';
import { AgentTrace } from '@/components/story/agent-trace';
import { BranchSelect } from '@/components/story/branch-select';
import { PreferencesSheet } from '@/components/story/preferences-panel';
import { StoryCommandPalette } from '@/components/story/command-palette';
import { ErrorState, LlmBanner } from '@/components/ui/error-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function StoryPage({ params }: { params: { id: string } }) {
  const storyId = params.id;
  const { t } = useApp();
  const dialogs = useDialogs();

  const [story, setStory] = useState<Story | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [nodes, setNodes] = useState<StoryNode[]>([]);
  const [prefHistory, setPrefHistory] = useState<StoryPreferenceVersion[]>([]);
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  const [retrieval, setRetrieval] = useState<RetrievalStep[]>([]);
  const [activity, setActivity] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [continuations, setContinuations] = useState<ContinuationOption[]>([]);
  const [showPrefs, setShowPrefs] = useState(false);
  const [showTreeMobile, setShowTreeMobile] = useState(false);
  const [view, setView] = useState<'read' | 'tree'>('read');
  const [cmdOpen, setCmdOpen] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );
  const path = useMemo(() => {
    const tip = selectedNode && selectedNode.branchId === activeBranchId
      ? walkPath(nodes, selectedNode)
      : walkPath(nodes, tipOfBranch(nodes, activeBranchId ?? ''));
    return tip;
  }, [nodes, selectedNode, activeBranchId]);

  const hasContent = path.some((n) => n.nodeType !== 'ROOT' && n.content.trim());
  const totalWords = path.reduce((n, node) => n + countWords(node.content), 0);
  const llmReady = Boolean(settings?.model && (settings.hasApiKey || settings.baseUrl));

  const loadStoryData = useCallback(async () => {
    setLoadError(null);
    try {
      const [s, branchList, allNodes, hist, llm] = await Promise.all([
        api.getStory(storyId),
        api.listBranches(storyId),
        api.listStoryNodes(storyId),
        api.getPreferenceHistory(storyId).catch(() => [] as StoryPreferenceVersion[]),
        api.getSettings().catch(() => null),
      ]);
      setStory(s);
      setBranches(branchList);
      setNodes(allNodes);
      setPrefHistory(hist);
      setSettings(llm);
      const first = branchList[0];
      setActiveBranchId((prev) => prev || first?.id || null);
      const tip = tipOfBranch(allNodes, (/* keep current */ first?.id) ?? '');
      setSelectedNodeId((prev) => prev || tip?.id || null);
      if (tip && !selectedNodeId) setDraft(tip.content);
      return { branchList, allNodes };
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load story');
      return null;
    }
  }, [storyId, selectedNodeId]);

  useEffect(() => {
    loadStoryData().then((data) => {
      if (!data) return;
      const first = data.branchList[0];
      const tip = tipOfBranch(data.allNodes, first?.id ?? '');
      if (tip) {
        setSelectedNodeId(tip.id);
        setDraft(tip.content);
        setActiveBranchId(first.id);
      }
    });
  }, [storyId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
      if (meta && e.key === 'Enter' && continuations[0] && !streaming) {
        e.preventDefault();
        chooseOption(continuations[0]);
      }
      if (!meta && !editingId && e.key === 'e' && selectedNode) {
        e.preventDefault();
        startEdit(selectedNode);
      }
      if (e.key === 'Escape') {
        setEditingId(null);
        setCmdOpen(false);
      }
      if (!meta && !editingId && continuations.length && /^[1-9]$/.test(e.key)) {
        const opt = continuations[Number(e.key) - 1];
        if (opt && !streaming) chooseOption(opt);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function selectNode(node: StoryNode) {
    setSelectedNodeId(node.id);
    setDraft(node.content);
    setSaveState('idle');
    setEditingId(null);
    if (node.branchId !== activeBranchId) setActiveBranchId(node.branchId);
  }

  function switchBranch(branch: Branch) {
    setActiveBranchId(branch.id);
    setContinuations([]);
    const tip = tipOfBranch(nodes, branch.id);
    if (tip) {
      setSelectedNodeId(tip.id);
      setDraft(tip.content);
    } else {
      setSelectedNodeId(null);
      setDraft('');
    }
    setShowTreeMobile(false);
  }

  function startEdit(node: StoryNode) {
    setSelectedNodeId(node.id);
    setDraft(node.content);
    setEditingId(node.id);
  }

  function onDraftChange(v: string) {
    setDraft(v);
    setSaveState('idle');
    const id = editingId ?? selectedNodeId;
    if (!id) return;
    const node = nodes.find((n) => n.id === id);
    if (!node || node.nodeType === 'ROOT') return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveState('saving');
      try {
        const updated = await api.updateNode(id, { content: v });
        setNodes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
        setSaveState('saved');
      } catch {
        setSaveState('idle');
      }
    }, 900);
  }

  async function runContinue(opts: {
    branchId: string;
    nodeId: string;
    parentBranchId?: string;
    instruction?: string;
    style?: string;
  }) {
    if (streaming) return;
    abortRef.current = new AbortController();
    setStreaming(true);
    setStreamText('');
    setContinuations([]);
    setRetrieval([]);
    setActivity('');
    try {
      await streamContinue(
        {
          storyId,
          branchId: opts.branchId,
          nodeId: opts.nodeId,
          parentBranchId: opts.parentBranchId,
          instruction: opts.instruction,
          style: opts.style,
        },
        {
          onDelta: (d) => setStreamText((prev) => prev + d),
          onRetrieval: (step) =>
            setRetrieval((prev) => {
              const i = prev.findIndex((s) => s.id === step.id);
              if (i === -1) return [...prev, step];
              const next = prev.slice();
              next[i] = step;
              return next;
            }),
          onActivity: setActivity,
          onNode: (n) => {
            setNodes((prev) => [...prev.filter((x) => x.id !== n.id), n]);
            setActiveBranchId(n.branchId);
            setSelectedNodeId(n.id);
            setDraft(n.content);
          },
          onContinuations: setContinuations,
          onError: (msg) => dialogs.notify({ message: msg }),
        },
        abortRef.current.signal,
      );
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        dialogs.notify({ message: err instanceof Error ? err.message : 'Generation failed' });
      }
    } finally {
      setStreaming(false);
    }
  }

  function chooseOption(option: ContinuationOption) {
    const from = selectedNode ?? tipOfBranch(nodes, activeBranchId ?? '');
    if (!from) return;
    runContinue({
      branchId: from.branchId,
      nodeId: from.id,
      instruction: `${option.label}: ${option.summary}`,
      style: option.label,
    });
  }

  async function branchFromOption(option: ContinuationOption) {
    const from = selectedNode ?? tipOfBranch(nodes, activeBranchId ?? '');
    if (!from || streaming) return;
    const created = await api.createBranch(storyId, {
      name: option.label,
      parentBranchId: from.branchId,
      forkNodeId: from.id,
    });
    setBranches((prev) => [...prev, created]);
    await runContinue({
      branchId: created.id,
      nodeId: from.id,
      parentBranchId: from.branchId,
      instruction: `${option.label}: ${option.summary}`,
      style: option.label,
    });
  }

  async function writeOwn(text: string) {
    const target = selectedNode ?? tipOfBranch(nodes, activeBranchId ?? '');
    if (!target) return;
    const created = await api.createNode({
      branchId: target.branchId,
      parentNodeId: target.id,
      content: text,
      nodeType: 'USER_WRITTEN',
      author: 'user',
      makeCurrent: true,
    });
    setNodes((prev) => [...prev, created]);
    setSelectedNodeId(created.id);
    setDraft(created.content);
    const { options } = await api.suggestions({ storyId, branchId: created.branchId, nodeId: created.id });
    setContinuations(options);
  }

  async function setChapter(node: StoryNode) {
    const title = await dialogs.prompt({ title: t('ne.chapter'), okLabel: t('ne.chapter') });
    if (!title) return;
    await api.createChapter(node.id, title);
    const all = await api.listStoryNodes(storyId);
    setNodes(all);
  }

  async function branchFromNode(node: StoryNode) {
    const name = await dialogs.prompt({ title: t('ws.newBranch'), initial: t('bm.whatIf'), okLabel: t('bm.new') });
    if (!name) return;
    const created = await api.createBranch(storyId, {
      name,
      parentBranchId: node.branchId,
      forkNodeId: node.id,
    });
    setBranches((prev) => [...prev, created]);
    await runContinue({
      branchId: created.id,
      nodeId: node.id,
      parentBranchId: node.branchId,
    });
  }

  async function deleteNode(node: StoryNode) {
    const ok = await dialogs.confirm({ title: t('bm.delete'), message: t('ms.deleteNode'), danger: true });
    if (!ok) return;
    await api.deleteNode(node.id);
    const all = await api.listStoryNodes(storyId);
    setNodes(all);
  }

  if (loadError) {
    return (
      <div className="flex h-full flex-col">
        <SiteHeader />
        <ErrorState title={t('err.load')} message={loadError} onRetry={() => loadStoryData()} />
      </div>
    );
  }

  if (!story) {
    return (
      <div className="flex h-full flex-col">
        <SiteHeader />
        <div className="grid flex-1 place-items-center">
          <Skeleton className="h-8 w-48" />
        </div>
      </div>
    );
  }

  const from = selectedNode ?? tipOfBranch(nodes, activeBranchId ?? '');

  return (
    <div className="flex h-full flex-col">
      <SiteHeader story={{ title: story.title }} />
      {!llmReady ? <LlmBanner /> : null}

      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <Button size="icon" variant="ghost" className="md:hidden" onClick={() => setShowTreeMobile((v) => !v)}>
          {showTreeMobile ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </Button>
        <BranchSelect
          storyId={storyId}
          branches={branches}
          activeBranchId={activeBranchId ?? ''}
          onSwitch={switchBranch}
          onChanged={async () => {
            const list = await api.listBranches(storyId);
            setBranches(list);
            if (activeBranchId && !list.some((b) => b.id === activeBranchId)) {
              switchBranch(list[0]);
            }
          }}
        />
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {t('ms.words', { n: totalWords })}
        </span>
        <Tabs value={view} onValueChange={(v) => setView(v as 'read' | 'tree')} className="ms-2">
          <TabsList>
            <TabsTrigger value="read">{t('ms.read')}</TabsTrigger>
            <TabsTrigger value="tree">{t('ms.canvas')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setShowPrefs(true)}>
          <SlidersHorizontal className="h-4 w-4" />
          {t('settings.preferences')}
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <a href={`/stories/${storyId}/graph`}>
            <Network className="h-4 w-4" />
          </a>
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={20} minSize={14} className={`${showTreeMobile ? 'absolute inset-y-24 start-0 z-20 w-72 border-e bg-background md:relative md:inset-auto' : 'hidden md:block'}`}>
            <StoryTree
              nodes={nodes}
              branches={branches}
              activeBranchId={activeBranchId ?? ''}
              selectedNodeId={selectedNodeId}
              onSelect={selectNode}
              onFocusBranch={(id) => {
                const b = branches.find((x) => x.id === id);
                if (b) switchBranch(b);
              }}
            />
          </ResizablePanel>
          <ResizableHandle className="hidden md:flex" />
          <ResizablePanel defaultSize={56} minSize={36}>
            {view === 'tree' ? (
              <StoryCanvas nodes={nodes} selectedNodeId={selectedNodeId} onSelect={selectNode} />
            ) : (
              <ScrollArea className="h-full">
                <Manuscript
                  path={path}
                  selectedId={selectedNodeId}
                  editingId={editingId}
                  draft={draft}
                  saveState={saveState}
                  streaming={streaming}
                  streamText={streamText}
                  prefHistory={prefHistory}
                  onSelect={selectNode}
                  onStartEdit={startEdit}
                  onDraftChange={onDraftChange}
                  onStopEdit={() => setEditingId(null)}
                  onChapter={setChapter}
                  onBranch={branchFromNode}
                  onDelete={deleteNode}
                />
                <WriteHead
                  options={continuations}
                  busy={streaming}
                  emptyStory={!hasContent && !streaming}
                  onChoose={chooseOption}
                  onBranch={branchFromOption}
                  onCustom={writeOwn}
                  onMore={async () => {
                    if (!from) return;
                    try {
                      const { options } = await api.suggestions({
                        storyId,
                        branchId: from.branchId,
                        nodeId: from.id,
                      });
                      setContinuations(options);
                    } catch (err) {
                      dialogs.notify({
                        message: err instanceof Error ? err.message : 'Failed to generate more',
                      });
                    }
                  }}
                  onGenerate={() => {
                    if (from) runContinue({ branchId: from.branchId, nodeId: from.id });
                  }}
                />
              </ScrollArea>
            )}
          </ResizablePanel>
          <ResizableHandle className="hidden lg:flex" />
          <ResizablePanel defaultSize={24} minSize={16} className="hidden lg:block">
            <AgentTrace steps={retrieval} streaming={streaming} activity={activity} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <PreferencesSheet storyId={storyId} open={showPrefs} onOpenChange={setShowPrefs} />
      <StoryCommandPalette
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        storyId={storyId}
        nodes={nodes}
        branches={branches}
        onSelectNode={selectNode}
        onSwitchBranch={switchBranch}
        onExport={() => {
          const b = branches.find((x) => x.id === activeBranchId);
          if (b) window.open(api.exportBranch(b.id), '_blank');
        }}
      />
    </div>
  );
}
