'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFloatingQueue } from './FloatingQueueProvider';

/**
 * Queue bubble UX:
 * - Dragging uses pointer capture.
 * - Drag/toggle ONLY when the pointer starts on the bubble itself.
 *   This prevents clicks inside the expanded panel (Clear All, job buttons) from collapsing the panel.
 *
 * Display rules (per Shawn):
 * - Show "Name (status)".
 * - Only ONE job should display as (running) at a time; any additional "running" items are shown as (queued)
 *   until they actually start running.
 */

const POS_KEY = 'otg:queuePos_v5';

type Pos = { x: number; y: number };

type QueueItem = {
  id: string;
  title: string;
  status: 'queued' | 'running' | 'complete' | 'error' | 'failed' | string;
  focusId?: string | null;
  resultName?: string | null;
};

function statusLabel(s: QueueItem['status']) {
  if (s === 'running') return 'running';
  if (s === 'queued') return 'queued';
  if (s === 'complete') return 'complete';
  if (s === 'error' || s === 'failed') return 'error';
  return String(s || 'queued');
}

function normalizeTitle(raw: string) {
  const t = String(raw || '').trim();
  if (!t) return 'job';
  return t.replace(/\s+/g, ' ').trim();
}

function lineText(name: string, status: string) {
  // ASCII-only punctuation to prevent mojibake.
  return `${name} (${status})`.trim();
}

function statusColor(s: string) {
  // Requested mapping:
  // - failed/error: red
  // - running: yellow
  // - complete: green
  // - queued: white
  if (s === 'error' || s === 'failed') return '#fb7185'; // red-ish
  if (s === 'running') return '#fbbf24'; // yellow
  if (s === 'complete') return '#34d399'; // green
  return 'rgba(255,255,255,0.92)'; // queued/other
}

export function FloatingQueueWidget() {
  const router = useRouter();
  const { items, isOpen, setOpen, clearAll } = useFloatingQueue();

  const typedItems = items as unknown as QueueItem[];

  /**
   * Sort items into a stable display order, and enforce "only one running".
   * We do this only for display; we do NOT mutate provider state.
   */
  const displayItems = useMemo(() => {
    const rank = (s: QueueItem['status']) => {
      if (s === 'running') return 0;
      if (s === 'queued') return 1;
      if (s === 'complete') return 2;
      if (s === 'error' || s === 'failed') return 3;
      return 9;
    };

    const sorted = [...typedItems].sort((a, b) => rank(a.status) - rank(b.status));

    let runningSeen = false;
    return sorted.map((it) => {
      if (it.status === 'running') {
        if (!runningSeen) {
          runningSeen = true;
          return it;
        }
        // Display extra "running" items as queued until they actually start running
        return { ...it, status: 'queued' as const };
      }
      return it;
    });
  }, [typedItems]);

  const activeCount = useMemo(
    () => typedItems.filter((i) => i.status === 'queued' || i.status === 'running').length,
    [typedItems]
  );

  const hasRunning = useMemo(() => typedItems.some((i) => i.status === 'running'), [typedItems]);

  const badgeCount = activeCount > 0 ? activeCount : typedItems.length;

  const [pos, setPos] = useState<Pos>(() => {
    if (typeof window === 'undefined') return { x: 20, y: 20 };
    try {
      const raw = window.localStorage.getItem(POS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed;
    } catch {}
    return { x: 20, y: 20 };
  });

  const bubbleRef = useRef<HTMLDivElement | null>(null);

  const dragRef = useRef<{
    dragging: boolean;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    moved: boolean;
    pointerId: number | null;
    downOnBubble: boolean;
  }>({
    dragging: false,
    startClientX: 0,
    startClientY: 0,
    startX: 0,
    startY: 0,
    moved: false,
    pointerId: null,
    downOnBubble: false,
  });

  const prevCountRef = useRef<number>(typedItems.length);
  const [pop, setPop] = useState(false);

  useEffect(() => {
    if (typedItems.length > prevCountRef.current) {
      setPop(true);
      const t = setTimeout(() => setPop(false), 260);
      prevCountRef.current = typedItems.length;
      return () => clearTimeout(t);
    }
    prevCountRef.current = typedItems.length;
  }, [typedItems]);

  if (typedItems.length === 0) return null;

  const savePos = (p: Pos) => {
    try {
      window.localStorage.setItem(POS_KEY, JSON.stringify(p));
    } catch {}
  };

  const visible = displayItems.slice(0, 3);
  const remaining = Math.max(0, displayItems.length - visible.length);

  const toggleOpen = () => setOpen(!isOpen);

  return (
    <div
      style={{
        position: 'fixed',
        right: pos.x,
        bottom: pos.y,
        zIndex: 9999,
        userSelect: 'none',
        touchAction: 'none',
      }}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        const downOnBubble =
          !!bubbleRef.current && (e.target instanceof Node ? bubbleRef.current.contains(e.target) : false);

        // Only bubble can begin drag or toggle.
        dragRef.current.downOnBubble = downOnBubble;
        if (!downOnBubble) return;

        dragRef.current.dragging = true;
        dragRef.current.pointerId = e.pointerId;
        dragRef.current.startClientX = e.clientX;
        dragRef.current.startClientY = e.clientY;
        dragRef.current.startX = pos.x;
        dragRef.current.startY = pos.y;
        dragRef.current.moved = false;

        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragRef.current.dragging) return;
        if (dragRef.current.pointerId !== e.pointerId) return;

        const dx = e.clientX - dragRef.current.startClientX;
        const dy = e.clientY - dragRef.current.startClientY;

        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragRef.current.moved = true;

        const nx = Math.max(0, dragRef.current.startX - dx);
        const ny = Math.max(0, dragRef.current.startY - dy);

        setPos({ x: nx, y: ny });
      }}
      onPointerUp={(e) => {
        if (dragRef.current.pointerId !== e.pointerId) return;

        dragRef.current.dragging = false;
        dragRef.current.pointerId = null;
        savePos(pos);

        // Toggle only if the pointer started on the bubble and did not move.
        if (dragRef.current.downOnBubble && !dragRef.current.moved) toggleOpen();

        dragRef.current.downOnBubble = false;
      }}
      onPointerCancel={(e) => {
        if (dragRef.current.pointerId !== e.pointerId) return;
        dragRef.current.dragging = false;
        dragRef.current.pointerId = null;
        dragRef.current.downOnBubble = false;
        savePos(pos);
      }}
    >
      <style jsx>{`
        @keyframes otg-pop {
          0% {
            transform: scale(1);
          }
          35% {
            transform: scale(1.12);
          }
          100% {
            transform: scale(1);
          }
        }
        .otg-pop {
          animation: otg-pop 260ms ease-out;
        }

        @keyframes otg-fadeUp {
          0% {
            opacity: 0;
            transform: translateY(6px) scale(0.98);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .otg-panelOpen {
          animation: otg-fadeUp 160ms ease-out;
        }
      `}</style>

      {/* Bubble */}
      <div
        ref={bubbleRef}
        aria-label={`Queue: ${badgeCount}`}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleOpen();
          }
        }}
        style={{
          width: 56,
          height: 56,
          borderRadius: 9999,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 800,
          fontSize: 18,
          color: '#fff',
          background: 'linear-gradient(90deg, rgb(124,58,237), rgb(14,165,233))',
          boxShadow: '0 12px 28px rgba(0,0,0,0.45)',
          position: 'relative',
          cursor: 'pointer',
        }}
        className={pop ? 'otg-pop' : ''}
      >
        {hasRunning && (
          <>
            <span
              style={{
                position: 'absolute',
                inset: -8,
                borderRadius: 9999,
                background: 'rgba(124,58,237,0.22)',
                animation: 'ping 1s cubic-bezier(0,0,0.2,1) infinite',
              }}
            />
            <span
              style={{
                position: 'absolute',
                inset: -4,
                borderRadius: 9999,
                background: 'rgba(14,165,233,0.12)',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
          </>
        )}
        <span style={{ position: 'relative' }}>{badgeCount}</span>
      </div>

      {/* Panel */}
      {isOpen && (
        <div
          className="otg-panelOpen"
          style={{
            marginTop: 12,
            width: 300,
            maxWidth: '82vw',
            borderRadius: 18,
            border: '1px solid rgba(255,255,255,0.10)',
            background: 'rgba(0,0,0,0.72)',
            backdropFilter: 'blur(14px)',
            boxShadow: '0 18px 55px rgba(0,0,0,0.55)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: 12 }}>
            <div style={{ display: 'grid', gap: 8 }}>
              {visible.map((item) => {
                const focus = item.focusId || item.resultName;
                const clickable = item.status === 'complete' && !!focus;

                const name = normalizeTitle(item.title);
                const s = statusLabel(item.status);
                const txt = lineText(name, s);
                const c = statusColor(s);

                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!clickable}
                    onClick={() => {
                      if (!clickable) return;
                      const f = encodeURIComponent(String(focus));
                      router.push(`/app?tab=gallery&focus=${f}`);
                      setOpen(false);
                    }}
                    title={name}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      borderRadius: 14,
                      padding: '10px 12px',
                      border: '1px solid rgba(255,255,255,0.10)',
                      background: 'rgba(255,255,255,0.05)',
                      color: c,
                      cursor: clickable ? 'pointer' : 'default',
                      opacity: clickable ? 1 : 0.95,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      fontSize: 13,
                      fontWeight: 800,
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{txt}</span>
                    <span style={{ width: 8, height: 8, borderRadius: 9999, background: c }} />
                  </button>
                );
              })}
            </div>

            {remaining > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8, color: 'rgba(255,255,255,0.85)' }}>
                +{remaining} more
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                clearAll();
                setOpen(false);
              }}
              style={{
                marginTop: 10,
                width: '100%',
                borderRadius: 14,
                padding: '10px 12px',
                border: '1px solid rgba(255,255,255,0.10)',
                background: 'rgba(255,255,255,0.10)',
                color: 'rgba(255,255,255,0.95)',
                fontSize: 12,
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              Clear All
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
