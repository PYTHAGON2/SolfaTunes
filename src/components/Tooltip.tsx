/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';

export interface TooltipProps {
  content: React.ReactNode;
  description?: string;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  delayMs?: number;
  disabled?: boolean;
  children: React.ReactElement;
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  description,
  shortcut,
  side = 'top',
  align = 'center',
  delayMs = 120,
  disabled = false,
  children,
  className = '',
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);

  const calculatePosition = () => {
    if (!triggerRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const gap = 8;

    let x = triggerRect.left + triggerRect.width / 2;
    let y = triggerRect.top;

    if (side === 'top') {
      y = triggerRect.top - gap;
    } else if (side === 'bottom') {
      y = triggerRect.bottom + gap;
    } else if (side === 'left') {
      x = triggerRect.left - gap;
      y = triggerRect.top + triggerRect.height / 2;
    } else if (side === 'right') {
      x = triggerRect.right + gap;
      y = triggerRect.top + triggerRect.height / 2;
    }

    if (align === 'start') {
      x = triggerRect.left;
    } else if (align === 'end') {
      x = triggerRect.right;
    }

    setCoords({ x, y });
  };

  const handleMouseEnter = () => {
    if (disabled || !content) return;
    calculatePosition();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      calculatePosition();
      setIsVisible(true);
    }, delayMs);
  };

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Update position on window scroll or resize if visible
  useEffect(() => {
    if (!isVisible) return;
    const handleScrollOrResize = () => {
      calculatePosition();
    };
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isVisible, side, align]);

  // Transform classes based on side and align
  const getTransformStyle = (): React.CSSProperties => {
    let translateX = '-50%';
    let translateY = '0%';

    if (side === 'top') {
      translateY = '-100%';
      if (align === 'start') translateX = '0%';
      if (align === 'end') translateX = '-100%';
    } else if (side === 'bottom') {
      translateY = '0%';
      if (align === 'start') translateX = '0%';
      if (align === 'end') translateX = '-100%';
    } else if (side === 'left') {
      translateX = '-100%';
      translateY = '-50%';
    } else if (side === 'right') {
      translateX = '0%';
      translateY = '-50%';
    }

    return {
      left: `${coords.x}px`,
      top: `${coords.y}px`,
      transform: `translate(${translateX}, ${translateY})`,
    };
  };

  return (
    <div
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
      className={`inline-flex ${className}`}
    >
      {children}

      {isVisible && !disabled && (
        <div
          ref={tooltipRef}
          style={getTransformStyle()}
          role="tooltip"
          className="fixed z-[9999] pointer-events-none select-none max-w-xs animate-in fade-in zoom-in-95 duration-100 ease-out"
        >
          <div className="bg-[#12141C]/95 border border-indigo-500/30 text-stone-200 text-xs rounded-xl px-2.5 py-1.5 shadow-2xl backdrop-blur-md flex flex-col gap-0.5 min-w-[max-content]">
            <div className="flex items-center justify-between gap-3">
              <span className="font-sans font-bold text-white text-[11px] leading-tight">
                {content}
              </span>
              {shortcut && (
                <kbd className="px-1.5 py-0.5 text-[9px] font-mono font-black uppercase tracking-wider bg-white/10 text-indigo-300 rounded border border-white/15 shadow-sm">
                  {shortcut}
                </kbd>
              )}
            </div>
            {description && (
              <span className="text-[10px] text-stone-400 font-sans leading-snug max-w-[200px]">
                {description}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
