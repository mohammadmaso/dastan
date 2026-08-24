'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, Plus, Search } from 'lucide-react';
import type { MemoryEntity, MemoryGraph } from '@storywriter/types';
import { useApp } from '@/lib/app-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { centerOn, clientToWorld, fitView, zoomAt, type View } from './memory-graph-nav';

const W = 2200;
const H = 1400;
const ITERATIONS = 300;
const NODE_W = 176;
const NODE_H = 60;
const GAP = 36;
const HW = NODE_W / 2;
const HH = NODE_H / 2;

interface Pt {
  x: number;
  y: number;
}

interface Link {
  id: string;
  s: number;
  t: number;
  type: string;
  summary?: string;
  bend: number;
}

/**
 * Fruchterman-Reingold layout. Deterministic: the same graph always lays out
 * the same way, so the picture doesn't jump between reloads.
 *
 * ponytail: O(n²) repulsion over a fixed iteration budget. The /graph endpoint
 * caps at 400 entities, which stays under ~50ms. Upgrade path: Barnes-Hut.
 */
function layout(count: number, links: Link[]): Pt[] {
  const pos: Pt[] = Array.from({ length: count }, (_, i) => {
    const a = (i / Math.max(count, 1)) * Math.PI * 2;
    const r = 160 + ((i * 0.618033) % 1) * 380;
    return { x: W / 2 + Math.cos(a) * r, y: H / 2 + Math.sin(a) * r };
  });
  if (count < 2) return pos;

  const k = Math.sqrt((W * H) / count);
  const disp: Pt[] = pos.map(() => ({ x: 0, y: 0 }));
  let temp = W / 8;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let i = 0; i < count; i++) {
      disp[i].x = 0;
      disp[i].y = 0;
    }
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) {
          dx = ((i * 7 + j) % 11) - 5;
          dy = ((i * 3 + j) % 13) - 6;
          d = Math.hypot(dx, dy) || 1;
        }
        const f = (k * k) / d / d;
        disp[i].x += dx * f;
        disp[i].y += dy * f;
        disp[j].x -= dx * f;
        disp[j].y -= dy * f;
      }
    }
    for (const l of links) {
      if (l.s === l.t) continue;
      const dx = pos[l.s].x - pos[l.t].x;
      const dy = pos[l.s].y - pos[l.t].y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = d / k;
      disp[l.s].x -= dx * f;
      disp[l.s].y -= dy * f;
      disp[l.t].x += dx * f;
      disp[l.t].y += dy * f;
    }
    for (let i = 0; i < count; i++) {
      const d = Math.hypot(disp[i].x, disp[i].y) || 1;
      const step = Math.min(d, temp);
      pos[i].x += (disp[i].x / d) * step;
      pos[i].y += (disp[i].y / d) * step;
      pos[i].x += (W / 2 - pos[i].x) * 0.008;
      pos[i].y += (H / 2 - pos[i].y) * 0.008;
    }
    temp = Math.max(temp * 0.975, 0.6);
  }
  return pos;
}

/** Push overlapping cards apart so HTML nodes don't sit on top of each other. */
function unstack(pos: Pt[]) {
  const minX = NODE_W + GAP;
  const minY = NODE_H + GAP;
  for (let iter = 0; iter < 50; iter++) {
    let moved = false;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const dx = pos[j].x - pos[i].x;
        const dy = pos[j].y - pos[i].y;
        const ox = minX - Math.abs(dx);
        const oy = minY - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (ox < oy) {
          const s = dx < 0 ? -1 : 1;
          pos[i].x -= (s * ox) / 2;
          pos[j].x += (s * ox) / 2;
        } else {
          const s = dy < 0 ? -1 : 1;
          pos[i].y -= (s * oy) / 2;
          pos[j].y += (s * oy) / 2;
        }
      }
    }
    if (!moved) break;
  }
}

function truncate(s: string, max = 42): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function boxOf(pts: Pt[]) {
  if (!pts.length) return { x: 0, y: 0, w: 800, h: 600 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x - HW - 80);
    minY = Math.min(minY, p.y - HH - 80);
    maxX = Math.max(maxX, p.x + HW + 80);
    maxY = Math.max(maxY, p.y + HH + 80);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function rectEdge(cx: number, cy: number, tx: number, ty: number): Pt {
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const t = Math.min(HW / Math.abs(dx || 1e-6), HH / Math.abs(dy || 1e-6));
  return { x: cx + dx * t, y: cy + dy * t };
}

function hsl(el: Element, name: string, a?: number): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return a == null ? `hsl(${v})` : `hsl(${v} / ${a})`;
}

function edgeCaption(l: Link): string {
  const s = l.summary?.trim();
  return s && s.toLowerCase() !== l.type.toLowerCase() ? s : l.type;
}

export function MemoryGraphView({
  graph,
  selectedId,
  onSelect,
}: {
  graph: MemoryGraph | null;
  selectedId: string | null;
  onSelect: (entity: MemoryEntity) => void;
}) {
  const { t } = useApp();
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<Pt[]>([]);
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const drag = useRef<{ i: number; dx: number; dy: number; x: number; y: number; moved: boolean } | null>(null);
  const skipClick = useRef(false);

  const model = useMemo(() => {
    const entities = graph?.entities ?? [];
    const index = new Map(entities.map((e, i) => [e.id, i]));

    const pairSeen = new Map<string, number>();
    const links: Link[] = [];
    for (const r of graph?.relationships ?? []) {
      const s = index.get(r.sourceId);
      const t = index.get(r.targetId);
      if (s === undefined || t === undefined) continue;
      const key = s < t ? `${s}:${t}` : `${t}:${s}`;
      const bend = pairSeen.get(key) ?? 0;
      pairSeen.set(key, bend + 1);
      links.push({
        id: r.id,
        s,
        t,
        type: r.type,
        summary: r.summary,
        bend,
      });
    }

    const neighbours = entities.map(() => new Set<number>());
    for (const l of links) {
      neighbours[l.s].add(l.t);
      neighbours[l.t].add(l.s);
    }

    const laid = layout(entities.length, links);
    unstack(laid);

    return { entities, links, neighbours, index, laid };
  }, [graph]);

  const graphKey = `${model.entities.map((e) => e.id).join(',')}|${model.links.map((l) => l.id).join(',')}`;

  useLayoutEffect(() => {
    const next = model.laid.map((p) => ({ ...p }));
    setPos(next);
    const el = viewportRef.current;
    if (!el || !next.length) return;
    setView(fitView(boxOf(next), el.clientWidth || 800, el.clientHeight || 600));
  }, [model.laid, graphKey]);

  const { entities, links, neighbours, index } = model;

  const extent = useMemo(() => boxOf(pos), [pos]);

  const fit = useCallback(() => {
    const el = viewportRef.current;
    if (!el || !pos.length) return;
    setView(fitView(extent, el.clientWidth, el.clientHeight));
  }, [extent, pos.length]);

  const activeId = hover ?? selectedId;
  const activeIdx = activeId != null ? index.get(activeId) : undefined;
  const isDim = useCallback(
    (i: number) => activeIdx !== undefined && i !== activeIdx && !neighbours[activeIdx].has(i),
    [activeIdx, neighbours],
  );

  const edgeGeom = useMemo(() => {
    return links.map((l) => {
      const a = pos[l.s];
      const b = pos[l.t];
      if (!a || !b) return null;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const offset = (l.bend % 2 === 0 ? 1 : -1) * (28 + Math.floor(l.bend / 2) * 36);
      const cx = (a.x + b.x) / 2 - (dy / len) * offset;
      const cy = (a.y + b.y) / 2 + (dx / len) * offset;
      const p1 = rectEdge(a.x, a.y, cx, cy);
      const p2 = rectEdge(b.x, b.y, cx, cy);
      const mx = 0.25 * p1.x + 0.5 * cx + 0.25 * p2.x;
      const my = 0.25 * p1.y + 0.5 * cy + 0.25 * p2.y;
      return { l, p1, p2, cx, cy, mx, my };
    });
  }, [links, pos]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = viewportRef.current;
    if (!canvas || !host) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, extent.w) * dpr;
    canvas.height = Math.max(1, extent.h) * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, extent.w, extent.h);

    const muted = hsl(host, '--muted-foreground');
    const primary = hsl(host, '--primary');
    const ox = -extent.x;
    const oy = -extent.y;

    for (const g of edgeGeom) {
      if (!g) continue;
      const dim = isDim(g.l.s) || isDim(g.l.t);
      const lit =
        g.l.id === hoverEdge ||
        (activeIdx !== undefined && (g.l.s === activeIdx || g.l.t === activeIdx));
      ctx.beginPath();
      ctx.moveTo(g.p1.x + ox, g.p1.y + oy);
      ctx.quadraticCurveTo(g.cx + ox, g.cy + oy, g.p2.x + ox, g.p2.y + oy);
      ctx.strokeStyle = lit ? primary : muted;
      ctx.globalAlpha = dim ? 0.08 : lit ? 1 : 0.45;
      ctx.lineWidth = lit ? 2.2 : 1.4;
      ctx.stroke();

      const ang = Math.atan2(g.p2.y - g.cy, g.p2.x - g.cx);
      ctx.save();
      ctx.translate(g.p2.x + ox, g.p2.y + oy);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-9, -4);
      ctx.lineTo(-9, 4);
      ctx.closePath();
      ctx.fillStyle = lit ? primary : muted;
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }, [edgeGeom, extent, hoverEdge, activeIdx, neighbours, isDim]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((v) => zoomAt(v, e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 0.89));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const el = viewportRef.current;
      if (!el) return;
      if (e.key === '+' || e.key === '=') {
        setView((v) => zoomAt(v, el.clientWidth / 2, el.clientHeight / 2, 1.2));
      } else if (e.key === '-' || e.key === '_') {
        setView((v) => zoomAt(v, el.clientWidth / 2, el.clientHeight / 2, 0.83));
      } else if (e.key === '0') {
        fit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fit]);

  function localPoint(e: { clientX: number; clientY: number }) {
    const el = viewportRef.current!;
    const r = el.getBoundingClientRect();
    return { mx: e.clientX - r.left, my: e.clientY - r.top };
  }

  function onViewportPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-graph-ui]')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pan.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  }

  function onViewportPointerMove(e: React.PointerEvent) {
    const nodeDrag = drag.current;
    if (nodeDrag) {
      if (!nodeDrag.moved && Math.hypot(e.clientX - nodeDrag.x, e.clientY - nodeDrag.y) < 5) return;
      const { mx, my } = localPoint(e);
      const w = clientToWorld(view, mx, my);
      nodeDrag.moved = true;
      setPos((prev) => {
        const next = prev.slice();
        next[nodeDrag.i] = { x: w.x - nodeDrag.dx, y: w.y - nodeDrag.dy };
        return next;
      });
      return;
    }
    const d = pan.current;
    if (!d) return;
    setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y) }));
  }

  function onViewportPointerUp() {
    if (drag.current?.moved) skipClick.current = true;
    pan.current = null;
    drag.current = null;
  }

  function onNodePointerDown(e: React.PointerEvent, i: number) {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const { mx, my } = localPoint(e);
    const w = clientToWorld(view, mx, my);
    drag.current = { i, dx: w.x - pos[i].x, dy: w.y - pos[i].y, x: e.clientX, y: e.clientY, moved: false };
    pan.current = null;
  }

  function onNodeClick(e: React.MouseEvent, entity: MemoryEntity) {
    e.stopPropagation();
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    onSelect(entity);
  }

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return entities.filter((e) => e.name.toLowerCase().includes(q) || e.type.toLowerCase().includes(q)).slice(0, 8);
  }, [entities, query]);

  function jumpTo(entity: MemoryEntity) {
    const el = viewportRef.current;
    const i = index.get(entity.id);
    if (!el || i == null || !pos[i]) return;
    setView((v) => centerOn(v, pos[i].x, pos[i].y, el.clientWidth, el.clientHeight));
    setQuery('');
    onSelect(entity);
  }

  return (
    <div
      ref={viewportRef}
      className="relative h-full w-full cursor-grab overflow-hidden bg-background touch-none active:cursor-grabbing"
      onPointerDown={onViewportPointerDown}
      onPointerMove={onViewportPointerMove}
      onPointerUp={onViewportPointerUp}
      onPointerLeave={onViewportPointerUp}
    >
      <div
        className="absolute left-0 top-0 origin-top-left will-change-transform"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
      >
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute"
          style={{ left: extent.x, top: extent.y, width: extent.w, height: extent.h }}
        />

        {edgeGeom.map((g) => {
          if (!g) return null;
          const dim = isDim(g.l.s) || isDim(g.l.t);
          const lit =
            g.l.id === hoverEdge ||
            (activeIdx !== undefined && (g.l.s === activeIdx || g.l.t === activeIdx));
          const caption = edgeCaption(g.l);
          const full = g.l.summary?.trim() ? `${g.l.type}: ${g.l.summary}` : g.l.type;
          return (
            <button
              key={g.l.id}
              type="button"
              data-graph-ui
              className={cn(
                'absolute z-10 max-w-[200px] -translate-x-1/2 -translate-y-1/2 rounded-md border bg-card/95 px-2 py-1 text-start shadow-sm backdrop-blur-sm transition-opacity',
                lit ? 'border-primary text-foreground' : 'text-muted-foreground',
                dim && 'opacity-20',
              )}
              style={{ left: g.mx, top: g.my }}
              title={full}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerEnter={() => setHoverEdge(g.l.id)}
              onPointerLeave={() => setHoverEdge(null)}
              onClick={(e) => {
                e.stopPropagation();
                const src = entities[g.l.s];
                if (src) onSelect(src);
              }}
            >
              <div className="text-[10px] font-medium uppercase tracking-wide text-primary">{g.l.type}</div>
              {caption !== g.l.type ? (
                <div className="text-[11px] leading-snug">{truncate(caption, 52)}</div>
              ) : null}
            </button>
          );
        })}

        {entities.map((e, i) => {
          const p = pos[i];
          if (!p) return null;
          const dim = isDim(i);
          const active = e.id === activeId;
          const selected = e.id === selectedId;
          return (
            <div
              key={e.id}
              data-graph-ui
              role="button"
              tabIndex={0}
              className={cn(
                'absolute z-20 flex w-[176px] -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col gap-1 rounded-lg border bg-card px-3 py-2 text-start shadow-sm transition-opacity',
                (active || selected) && 'border-primary ring-2 ring-primary/25',
                dim && 'opacity-25',
              )}
              style={{ left: p.x, top: p.y }}
              onPointerDown={(ev) => onNodePointerDown(ev, i)}
              onPointerMove={onViewportPointerMove}
              onPointerUp={onViewportPointerUp}
              onPointerEnter={() => setHover(e.id)}
              onPointerLeave={() => setHover(null)}
              onClick={(ev) => onNodeClick(ev, e)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  onSelect(e);
                }
              }}
            >
              <span className="truncate text-sm font-medium leading-tight">{e.name}</span>
              <Badge variant="secondary" className="w-fit px-1.5 py-0 text-[10px]">
                {e.type}
              </Badge>
            </div>
          );
        })}
      </div>

      <div
        data-graph-ui
        className="absolute start-3 top-3 z-30 flex max-w-[min(100%-6rem,22rem)] flex-col gap-2"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('graph.search')}
            className="bg-card/95 ps-8 shadow-sm backdrop-blur-sm"
          />
          {query.trim() ? (
            <div className="absolute inset-x-0 top-full z-40 mt-1 overflow-hidden rounded-md border bg-popover shadow-md">
              {matches.length ? (
                matches.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-accent"
                    onClick={() => jumpTo(e)}
                  >
                    <span className="truncate">{e.name}</span>
                    <span className="text-xs text-muted-foreground">{e.type}</span>
                  </button>
                ))
              ) : (
                <p className="px-3 py-2 text-sm text-muted-foreground">{t('graph.noMatch')}</p>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div
        data-graph-ui
        className="absolute end-3 top-3 z-30 flex flex-col gap-1"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="bg-card/95 shadow-sm backdrop-blur-sm"
              onClick={() => {
                const el = viewportRef.current;
                if (!el) return;
                setView((v) => zoomAt(v, el.clientWidth / 2, el.clientHeight / 2, 1.2));
              }}
              aria-label={t('graph.zoomIn')}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('graph.zoomIn')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="bg-card/95 shadow-sm backdrop-blur-sm"
              onClick={() => {
                const el = viewportRef.current;
                if (!el) return;
                setView((v) => zoomAt(v, el.clientWidth / 2, el.clientHeight / 2, 0.83));
              }}
              aria-label={t('graph.zoomOut')}
            >
              <Minus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('graph.zoomOut')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="bg-card/95 shadow-sm backdrop-blur-sm"
              onClick={fit}
              aria-label={t('graph.fit')}
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('graph.fit')}</TooltipContent>
        </Tooltip>
      </div>

      <p className="pointer-events-none absolute bottom-3 start-3 z-30 rounded-md bg-card/80 px-2 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm">
        {t('graph.hint')}
      </p>
    </div>
  );
}
