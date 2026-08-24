'use client';

import { useMemo, useRef, useState } from 'react';
import type { MemoryEntity, MemoryGraph } from '@storywriter/types';

const W = 1200;
const H = 800;
const ITERATIONS = 300;
const PAD = 70;

interface Pt {
  x: number;
  y: number;
}

interface Link {
  id: string;
  s: number;
  t: number;
  type: string;
  /** Index among links sharing the same pair, so parallel edges fan out. */
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
    // Golden-ratio radius spread keeps the seed ring from being a perfect
    // circle, which the symmetric force model would never break out of.
    const r = 120 + ((i * 0.618033) % 1) * 220;
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
      // Gentle pull to centre keeps disconnected islands from drifting away.
      pos[i].x += (W / 2 - pos[i].x) * 0.008;
      pos[i].y += (H / 2 - pos[i].y) * 0.008;
    }
    temp = Math.max(temp * 0.975, 0.6);
  }
  return pos;
}

function truncate(s: string, max = 20): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
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
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

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
      links.push({ id: r.id, s, t, type: r.type, bend });
    }

    const degree = new Array(entities.length).fill(0);
    for (const l of links) {
      degree[l.s]++;
      degree[l.t]++;
    }

    const pos = layout(entities.length, links);
    const radii = degree.map((d: number) => 7 + Math.min(d, 10) * 1.6);

    // Neighbour sets drive the hover/select highlight.
    const neighbours = entities.map(() => new Set<number>());
    for (const l of links) {
      neighbours[l.s].add(l.t);
      neighbours[l.t].add(l.s);
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pos) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const box = pos.length
      ? { x: minX - PAD, y: minY - PAD, w: maxX - minX + PAD * 2, h: maxY - minY + PAD * 2 }
      : { x: 0, y: 0, w: W, h: H };

    return { entities, links, pos, radii, neighbours, index, box };
  }, [graph]);

  const { entities, links, pos, radii, neighbours, index, box } = model;

  const activeId = hover ?? selectedId;
  const activeIdx = activeId != null ? index.get(activeId) : undefined;
  const isDim = (i: number) =>
    activeIdx !== undefined && i !== activeIdx && !neighbours[activeIdx].has(i);

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    setView((v) => ({ ...v, k: Math.min(4, Math.max(0.3, v.k * (e.deltaY < 0 ? 1.12 : 0.89))) }));
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y) }));
  }

  return (
    <svg
      className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      preserveAspectRatio="xMidYMid meet"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (drag.current = null)}
      onPointerLeave={() => {
        drag.current = null;
        setHover(null);
      }}
    >
      <defs>
        <marker
          id="mg-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
        </marker>
      </defs>

      <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        <g className="text-muted-foreground">
          {links.map((l) => {
            const a = pos[l.s];
            const b = pos[l.t];
            const dim = isDim(l.s) || isDim(l.t);
            const lit =
              activeIdx !== undefined && (l.s === activeIdx || l.t === activeIdx);

            // Fan parallel edges apart, and bow every edge slightly so the
            // graph reads as organic rather than a wire diagram.
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const offset = (l.bend % 2 === 0 ? 1 : -1) * (18 + Math.floor(l.bend / 2) * 26);
            const cx = (a.x + b.x) / 2 - (dy / len) * offset;
            const cy = (a.y + b.y) / 2 + (dx / len) * offset;

            // Stop the line at the circle's edge so the arrowhead sits outside.
            const sa = Math.atan2(cy - a.y, cx - a.x);
            const ea = Math.atan2(b.y - cy, b.x - cx);
            const x1 = a.x + Math.cos(sa) * radii[l.s];
            const y1 = a.y + Math.sin(sa) * radii[l.s];
            const x2 = b.x - Math.cos(ea) * (radii[l.t] + 7);
            const y2 = b.y - Math.sin(ea) * (radii[l.t] + 7);

            return (
              <g
                key={l.id}
                className={lit ? 'text-primary' : undefined}
                opacity={dim ? 0.07 : lit ? 1 : 0.4}
                style={{ transition: 'opacity 180ms' }}
              >
                <path
                  d={`M${x1},${y1} Q${cx},${cy} ${x2},${y2}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={lit ? 1.6 : 1}
                  markerEnd="url(#mg-arrow)"
                />
                {lit ? (
                  <text
                    x={cx}
                    y={cy}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={11}
                    fill="currentColor"
                    className="pointer-events-none"
                    paintOrder="stroke"
                    stroke="hsl(var(--background))"
                    strokeWidth={4}
                  >
                    {l.type}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>

        {entities.map((e, i) => {
          const p = pos[i];
          const dim = isDim(i);
          const active = e.id === activeId;
          const selected = e.id === selectedId;
          return (
            <g
              key={e.id}
              transform={`translate(${p.x} ${p.y})`}
              opacity={dim ? 0.15 : 1}
              className="cursor-pointer"
              style={{ transition: 'opacity 180ms' }}
              onPointerEnter={() => setHover(e.id)}
              onPointerLeave={() => setHover(null)}
              onClick={() => onSelect(e)}
            >
              {active ? (
                <circle r={radii[i] + 7} className="fill-primary" opacity={0.14} />
              ) : null}
              <circle
                r={radii[i]}
                className={selected || active ? 'fill-primary' : 'fill-muted-foreground'}
                stroke="hsl(var(--background))"
                strokeWidth={2}
              />
              <text
                y={radii[i] + 15}
                textAnchor="middle"
                fontSize={12}
                className={`pointer-events-none ${active ? 'fill-foreground' : 'fill-muted-foreground'}`}
                paintOrder="stroke"
                stroke="hsl(var(--background))"
                strokeWidth={3}
              >
                {truncate(e.name)}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
