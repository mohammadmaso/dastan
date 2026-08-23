'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
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
import { StoryFlow } from '@/components/story/story-flow';
import { NodeModal } from '@/components/story/node-modal';
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
  const [modalNodeId, setModalNodeId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [continuations, setContinuations] = useState<ContinuationOption[]>([]);
  const [generatingParentId, setGeneratingParentId] = useState<string | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);

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
  const branchNames = useMemo(
    () => Object.fromEntries(branches.map((b) => [b.id, b.name])),
    [branches],
  );
  const modalNode = useMemo(
    () => allNodes.find((n) => n.id === modalNodeId) ?? null,
    [allNodes, modalNodeId],
  );
  const rootNode = useMemo(
    () => allNodes.find((n) => !n.parentNodeId) ?? allNodes[0] ?? null,
    [allNodes],
  );
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
  }, [storyId]);

  useEffect(() => {
    loadStoryData();
    return () => {
      if (watchdogRef.current) clearInterval(watchdogRef.current);
      suggestAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- selection / suggestions --------------------------------------------
  async function loadSuggestions(node: StoryNode) {
    suggestAbortRef.current?.abort();
    const ctrl = new AbortController();
    suggestAbortRef.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 60_000);
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

  /** Open a node's modal (editable text + next-step suggestions). */
  function openNode(node: StoryNode) {
    setModalNodeId(node.id);
    setDraft(node.content);
    setSaveState('idle');
    // Reuse cached suggestions for this node; fetch fresh ones only the first time.
    if (suggestionsNodeRef.current !== node.id) {
      setContinuations([]);
      if (!streaming) loadSuggestions(node);
    }
  }

  function closeModal() {
    setModalNodeId(null);
  }

  // ---- editing -------------------------------------------------------------
  function onDraftChange(v: string) {
    setDraft(v);
    setSaveState('idle');
    if (!modalNode || modalNode.nodeType === 'ROOT') return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const id = modalNode.id;
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
    setGeneratingParentId(opts.nodeId);
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
            setGeneratingParentId(null);
            // Auto-open the modal on the freshly generated node.
            setModalNodeId(n.id);
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
      setGeneratingParentId(null);
      if (watchdogRef.current) {
        clearInterval(watchdogRef.current);
        watchdogRef.current = null;
      }
    }
  }

  /** One-click: the AI writes the opening scene from the ROOT node. */
  function startOpening() {
    if (!rootNode) return;
    runContinue({ branchId: rootNode.branchId, nodeId: rootNode.id });
  }

  function chooseOption(option: ContinuationOption) {
    if (!modalNode) return;
    runContinue({
      branchId: modalNode.branchId,
      nodeId: modalNode.id,
      instruction: `${option.label}: ${option.summary}`,
      style: option.label,
    });
  }

  async function branchFromOption(option: ContinuationOption) {
    if (!modalNode || streaming) return;
    const created = await api.createBranch(storyId, {
      name: option.label,
      parentBranchId: modalNode.branchId,
    });
    setBranches((prev) => [...prev, created]);
    setNodesByBranch((prev) => ({ ...prev, [created.id]: [] }));
    await runContinue({
      branchId: created.id,
      nodeId: modalNode.id,
      parentBranchId: modalNode.branchId,
      instruction: `${option.label}: ${option.summary}`,
      style: option.label,
    });
  }

  async function writeOwn(text: string) {
    const target = modalNode ?? rootNode;
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
    setActiveBranchId(created.branchId);
    setModalNodeId(created.id);
    setDraft(created.content);
    await loadSuggestions(created);
  }

  async function generateMore() {
    if (!modalNode) return;
    await loadSuggestions(modalNode);
  }

  async function setChapter() {
    if (!modalNode) return;
    const title = await dialogs.prompt({
      title: t('ne.chapter'),
      placeholder: t('bm.whatIf'),
      okLabel: t('ne.chapter'),
    });
    if (!title) return;
    await api.createChapter(modalNode.id, title);
    const reloaded = await api.listNodes(modalNode.branchId);
    setNodesByBranch((prev) => ({ ...prev, [modalNode.branchId]: reloaded }));
  }

  async function branchFromNode() {
    if (!modalNode || streaming) return;
    const name = await dialogs.prompt({
      title: t('ws.newBranch'),
      initial: t('bm.whatIf'),
      okLabel: t('bm.new'),
    });
    if (!name) return;
    const created = await api.createBranch(storyId, {
      name,
      parentBranchId: modalNode.branchId,
    });
    setBranches((prev) => [...prev, created]);
    setNodesByBranch((prev) => ({ ...prev, [created.id]: [] }));
    await runContinue({
      branchId: created.id,
      nodeId: modalNode.id,
      parentBranchId: modalNode.branchId,
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

  return (
    <div className="flex h-full flex-col">
      <SiteHeader story={{ title: story.title }} />

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          {hasContent ? (
            <StoryFlow
              nodes={allNodes}
              branchNames={branchNames}
              currentBranchId={activeBranchId}
              openNodeId={modalNodeId}
              onNodeClick={openNode}
              streaming={streaming}
              streamText={streamText}
              generatingParentId={generatingParentId}
            />
          ) : (
            <div className="grid h-full place-items-center overflow-y-auto">
              <StartScreen
                storyId={storyId}
                busy={streaming}
                onGenerate={startOpening}
                onSaveOwn={writeOwn}
              />
            </div>
          )}
        </div>

        <Button
          size="sm"
          variant="outline"
          className="absolute end-3 top-3 z-20"
          onClick={() => setShowPrefs((v) => !v)}
        >
          {showPrefs ? <X className="h-4 w-4" /> : <SlidersHorizontal className="h-4 w-4" />}
          {t('settings.preferences')}
        </Button>

        {showPrefs && (
          <aside className="absolute inset-y-0 end-0 z-30 flex w-80 flex-col border-s bg-background shadow-xl">
            <PreferencesPanel storyId={storyId} onClose={() => setShowPrefs(false)} />
          </aside>
        )}
      </div>

      {modalNode && (
        <NodeModal
          node={modalNode}
          draft={draft}
          onDraftChange={onDraftChange}
          saveState={saveState}
          streaming={streaming}
          options={continuations}
          branchName={branchNames[modalNode.branchId] ?? ''}
          onClose={closeModal}
          onChoose={chooseOption}
          onMore={generateMore}
          onCustom={writeOwn}
          onBranchFromOption={branchFromOption}
          onBranch={branchFromNode}
          onSetChapter={setChapter}
        />
      )}
    </div>
  );
}
