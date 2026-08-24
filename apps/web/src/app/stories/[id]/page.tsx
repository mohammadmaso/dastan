'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, SlidersHorizontal, X } from 'lucide-react';
import type {
  ActivityEvent,
  Branch,
  ContinuationOption,
  Story,
  StoryNode,
} from '@storywriter/types';
import { api, streamContinue } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { useDialogs } from '@/lib/dialogs';
import { SiteHeader } from '@/components/site-header';
import { StoryTree } from '@/components/story/story-tree';
import { NodeEditor } from '@/components/story/node-editor';
import { ActivityPanel } from '@/components/story/activity-panel';
import { Continuations } from '@/components/story/continuations';
import { BranchSelect } from '@/components/story/branch-select';
import { StartScreen } from '@/components/story/start-screen';
import { PreferencesPanel } from '@/components/story/preferences-panel';
import { Button } from '@/components/ui/button';

export default function StoryPage({ params }: { params: { id: string } }) {
  const storyId = params.id;
  const { t } = useApp();
  const dialogs = useDialogs();
  const [story, setStory] = useState<Story | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [nodesByBranch, setNodesByBranch] = useState<Record<string, StoryNode[]>>({});

  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [continuations, setContinuations] = useState<ContinuationOption[]>([]);
  const [showPrefs, setShowPrefs] = useState(false);
  const [showTreeMobile, setShowTreeMobile] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Watchdog: if the stream stalls, abort so the UI never stays stuck "writing".
  const lastChunkAt = useRef(Date.now());
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Suggestion fetches: cancel the previous one, bound the wait, cache per node.
  const suggestAbortRef = useRef<AbortController | null>(null);
  const suggestionsNodeRef = useRef<string | null>(null);
  const lastEmittedNodeRef = useRef<string | null>(null);

  const allNodes = useMemo(() => Object.values(nodesByBranch).flat(), [nodesByBranch]);
  const selectedNode = useMemo(
    () => allNodes.find((n) => n.id === selectedNodeId) ?? null,
    [allNodes, selectedNodeId],
  );
  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;
  const hasContent = useMemo(
    () => allNodes.some((n) => n.nodeType !== 'ROOT' && n.content.trim().length > 0),
    [allNodes],
  );

  // ---- loading -------------------------------------------------------------
  const loadStoryData = useCallback(async () => {
    const [s, branchList] = await Promise.all([api.getStory(storyId), api.listBranches(storyId)]);
    setStory(s);
    setBranches(branchList);
    const map: Record<string, StoryNode[]> = {};
    await Promise.all(
      branchList.map(async (b) => {
        map[b.id] = await api.listNodes(b.id);
      }),
    );
    setNodesByBranch(map);
    setActiveBranchId((prev) => prev || branchList[0]?.id || null);
    return map;
  }, [storyId]);

  useEffect(() => {
    loadStoryData().then((map) => {
      const first = branches[0]?.id;
      const nodes = first ? map[first] ?? [] : [];
      const current = nodes.find((n) => n.isCurrent) ?? nodes[0] ?? null;
      if (current) {
        setSelectedNodeId(current.id);
        setDraft(current.content);
      }
    });
    return () => {
      if (watchdogRef.current) clearInterval(watchdogRef.current);
      suggestAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadBranchNodes = useCallback(async (branchId: string) => {
    const nodes = await api.listNodes(branchId);
    setNodesByBranch((prev) => ({ ...prev, [branchId]: nodes }));
    return nodes;
  }, []);

  // ---- selection / suggestions --------------------------------------------
  function selectNode(node: StoryNode) {
    setSelectedNodeId(node.id);
    setDraft(node.content);
    setSaveState('idle');
  }

  function switchBranch(branch: Branch) {
    setActiveBranchId(branch.id);
    setContinuations([]);
    const nodes = nodesByBranch[branch.id] ?? [];
    const current = nodes.find((n) => n.isCurrent) ?? nodes[nodes.length - 1] ?? null;
    if (current) {
      setSelectedNodeId(current.id);
      setDraft(current.content);
    } else {
      setSelectedNodeId(null);
      setDraft('');
    }
    setShowTreeMobile(false);
  }

  async function loadSuggestions(node: StoryNode) {
    suggestAbortRef.current?.abort();
    const ctrl = new AbortController();
    suggestAbortRef.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 120_000);
    try {
      const { options } = await api.suggestions(
        { storyId, branchId: node.branchId, nodeId: node.id },
        ctrl.signal,
      );
      if (!ctrl.signal.aborted) {
        setContinuations(options);
        suggestionsNodeRef.current = node.id;
      }
    } catch {
      if (!ctrl.signal.aborted) setContinuations([]);
    } finally {
      clearTimeout(timer);
      if (suggestAbortRef.current === ctrl) suggestAbortRef.current = null;
    }
  }

  // ---- editing -------------------------------------------------------------
  function onDraftChange(v: string) {
    setDraft(v);
    setSaveState('idle');
    if (!selectedNode || selectedNode.nodeType === 'ROOT') return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const id = selectedNode.id;
      setSaveState('saving');
      try {
        const updated = await api.updateNode(id, { content: v });
        setNodesByBranch((prev) => ({
          ...prev,
          [updated.branchId]: (prev[updated.branchId] ?? []).map((n) =>
            n.id === updated.id ? updated : n,
          ),
        }));
        setSaveState('saved');
      } catch {
        setSaveState('idle');
      }
    }, 900);
  }

  // ---- generation ----------------------------------------------------------
  async function runContinue(opts: {
    branchId: string;
    nodeId: string;
    parentBranchId?: string;
    instruction?: string;
    style?: string;
  }) {
    if (streaming) return;
    abortRef.current = new AbortController();
    lastChunkAt.current = Date.now();
    setStreaming(true);
    setStreamText('');
    setContinuations([]);
    setActivity([]);
    // If no SSE data arrives for 90s, abort so the UI can recover.
    watchdogRef.current = setInterval(() => {
      if (Date.now() - lastChunkAt.current > 90_000) {
        abortRef.current?.abort();
        dialogs.notify({ message: t('flow.idle') });
      }
    }, 10_000);
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
        (chunk) => {
          lastChunkAt.current = Date.now();
          if (chunk.kind === 'activity' && chunk.activity) {
            const act = chunk.activity;
            setActivity((prev) => [...prev, act]);
            if (act.token) setStreamText((prev) => prev + (act.token ?? ''));
          } else if (chunk.kind === 'node' && chunk.node) {
            const n = chunk.node;
            lastEmittedNodeRef.current = n.id;
            setNodesByBranch((prev) => ({
              ...prev,
              [n.branchId]: [...(prev[n.branchId] ?? []).filter((x) => x.id !== n.id), n],
            }));
            setActiveBranchId(n.branchId);
            setSelectedNodeId(n.id);
            setDraft(n.content);
            setSaveState('idle');
          } else if (chunk.kind === 'continuations') {
            setContinuations(chunk.continuations ?? []);
            if (lastEmittedNodeRef.current) {
              suggestionsNodeRef.current = lastEmittedNodeRef.current;
            }
          } else if (chunk.kind === 'error') {
            dialogs.notify({ message: chunk.error ?? 'Generation failed' });
          } else if (chunk.kind === 'done') {
            setStreaming(false);
          }
        },
        abortRef.current.signal,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generation failed';
      if ((err as any)?.name !== 'AbortError') dialogs.notify({ message: msg });
    } finally {
      setStreaming(false);
      if (watchdogRef.current) {
        clearInterval(watchdogRef.current);
        watchdogRef.current = null;
      }
    }
  }

  /** One-click: the AI writes the opening scene from premise/preferences. */
  function startOpening() {
    if (!selectedNode) return;
    runContinue({ branchId: selectedNode.branchId, nodeId: selectedNode.id });
  }

  function chooseOption(option: ContinuationOption) {
    if (!selectedNode) return;
    runContinue({
      branchId: selectedNode.branchId,
      nodeId: selectedNode.id,
      instruction: `${option.label}: ${option.summary}`,
      style: option.label,
    });
  }

  async function branchFromOption(option: ContinuationOption) {
    if (!selectedNode || streaming) return;
    const created = await api.createBranch(storyId, {
      name: option.label,
      parentBranchId: selectedNode.branchId,
    });
    setBranches((prev) => [...prev, created]);
    setNodesByBranch((prev) => ({ ...prev, [created.id]: [] }));
    await runContinue({
      branchId: created.id,
      nodeId: selectedNode.id,
      parentBranchId: selectedNode.branchId,
      instruction: `${option.label}: ${option.summary}`,
      style: option.label,
    });
  }

  async function writeOwn(text: string) {
    const target = selectedNode ?? null;
    if (!target) return;
    const created = await api.createNode({
      branchId: target.branchId,
      parentNodeId: target.id,
      content: text,
      nodeType: 'USER_WRITTEN',
      author: 'user',
      makeCurrent: true,
    });
    setNodesByBranch((prev) => ({
      ...prev,
      [created.branchId]: [...(prev[created.branchId] ?? []), created],
    }));
    setSelectedNodeId(created.id);
    setDraft(created.content);
    await loadSuggestions(created);
  }

  async function generateMore() {
    if (!selectedNode) return;
    await loadSuggestions(selectedNode);
  }

  async function setChapter() {
    if (!selectedNode) return;
    const title = await dialogs.prompt({
      title: t('ne.chapter'),
      placeholder: t('bm.whatIf'),
      okLabel: t('ne.chapter'),
    });
    if (!title) return;
    await api.createChapter(selectedNode.id, title);
    await loadBranchNodes(selectedNode.branchId);
  }

  async function branchFromNode() {
    if (!selectedNode || streaming) return;
    const name = await dialogs.prompt({
      title: t('ws.newBranch'),
      initial: t('bm.whatIf'),
      okLabel: t('bm.new'),
    });
    if (!name) return;
    const created = await api.createBranch(storyId, {
      name,
      parentBranchId: selectedNode.branchId,
    });
    setBranches((prev) => [...prev, created]);
    setNodesByBranch((prev) => ({ ...prev, [created.id]: [] }));
    await runContinue({
      branchId: created.id,
      nodeId: selectedNode.id,
      parentBranchId: selectedNode.branchId,
    });
  }

  if (!story) {
    return (
      <div className="flex h-full flex-col">
        <SiteHeader />
        <main className="grid flex-1 place-items-center text-sm text-muted-foreground">
          {t('dash.loading')}
        </main>
      </div>
    );
  }

  const showStart = !hasContent && !streaming;
  const showBottom = hasContent || streaming || continuations.length > 0;

  return (
    <div className="flex h-full flex-col">
      <SiteHeader story={{ title: story.title }} />

      <div className="flex flex-1 overflow-hidden">
        {/* LEFT: the narrative tree, always visible on desktop */}
        <aside
          className={`${
            showTreeMobile ? 'absolute inset-y-12 start-0 z-30 flex w-80 flex-col border-e bg-background' : 'hidden'
          } w-80 shrink-0 flex-col border-e bg-background md:flex`}
        >
          <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
            {t('ws.treeCaption')}
          </div>
          <div className="flex min-h-0 flex-1">
            <StoryTree
              nodes={allNodes}
              activeBranchId={activeBranchId ?? ''}
              selectedNodeId={selectedNodeId}
              onSelect={selectNode}
            />
          </div>
          {showTreeMobile && (
            <Button variant="ghost" size="sm" className="md:hidden" onClick={() => setShowTreeMobile(false)}>
              <X className="h-4 w-4" /> {t('new.back')}
            </Button>
          )}
        </aside>

        {/* RIGHT: writing surface */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-4 py-2">
            <Button size="icon" variant="ghost" className="md:hidden" onClick={() => setShowTreeMobile((v) => !v)}>
              <Menu className="h-4 w-4" />
            </Button>
            <BranchSelect
              storyId={storyId}
              branches={branches}
              activeBranchId={activeBranchId ?? ''}
              onSwitch={switchBranch}
              onChanged={async () => {
                await loadStoryData();
              }}
            />
            <span className="hidden truncate text-sm text-muted-foreground sm:inline">
              {selectedNode ? t('ws.nodepos', { n: selectedNode.position + 1 }) : ''}
              {!streaming && continuations.length === 0 && selectedNode?.isCurrent ? t('ws.current') : ''}
            </span>
            <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setShowPrefs((v) => !v)}>
              {showPrefs ? <X className="h-4 w-4" /> : <SlidersHorizontal className="h-4 w-4" />}
              {t('settings.preferences')}
            </Button>
          </div>

          <div className="min-h-0 flex-1">
            {showStart ? (
              <StartScreen storyId={storyId} busy={streaming} onGenerate={startOpening} onSaveOwn={writeOwn} />
            ) : (
              <NodeEditor
                node={selectedNode}
                draft={draft}
                onDraftChange={onDraftChange}
                streaming={streaming}
                streamText={streamText}
                saveState={saveState}
                onSetChapter={setChapter}
                onBranch={branchFromNode}
              />
            )}
          </div>

          {showBottom && (
            <div className="grid shrink-0 gap-3 border-t p-3 md:grid-cols-2">
              <ActivityPanel events={activity} streaming={streaming} />
              <Continuations
                options={continuations}
                onChoose={chooseOption}
                onMore={generateMore}
                onCustom={writeOwn}
                onBranchFromOption={branchFromOption}
                busy={streaming}
              />
            </div>
          )}
        </main>

        {/* RIGHT: preferences drawer */}
        {showPrefs && (
          <aside className="absolute inset-y-11 end-0 z-20 w-80 border-s bg-background p-3 md:relative md:inset-auto md:shrink-0">
            <PreferencesPanel storyId={storyId} onClose={() => setShowPrefs(false)} />
          </aside>
        )}
      </div>
    </div>
  );
}
