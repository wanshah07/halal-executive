"use client";

// nav-header: the sliding-pill tab bar Wan sent (15 Oct 2026), made to take
// the site's own tabs. Text only, no icons. The black pill rests on the open
// tab and follows the pointer; the label over it turns white through
// mix-blend-difference. Used in the header on tablets and desktops; phones
// keep the icon bar.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

type Item = { value: string; label: React.ReactNode; href?: string };
type Pos = { left: number; width: number; opacity: number };

function NavHeader({ items, value, onChange, className }: { items: Item[]; value?: string; onChange?: (v: string) => void; className?: string }) {
  const listRef = useRef<HTMLUListElement>(null);
  const refs = useRef<Record<string, HTMLLIElement | null>>({});
  const [position, setPosition] = useState<Pos>({ left: 0, width: 0, opacity: 0 });

  const restOnActive = useCallback(() => {
    const el = value ? refs.current[value] : null;
    if (el) setPosition({ left: el.offsetLeft, width: el.getBoundingClientRect().width, opacity: 1 });
    else setPosition((p) => ({ ...p, opacity: 0 }));
  }, [value]);

  useLayoutEffect(() => { restOnActive(); }, [restOnActive]);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(restOnActive);
    ro.observe(el);
    // Keep the open tab in view when the bar scrolls sideways.
    const act = value ? refs.current[value] : null;
    act?.scrollIntoView({ block: "nearest", inline: "nearest" });
    return () => ro.disconnect();
  }, [restOnActive, value]);

  return (
    <ul
      ref={listRef}
      className={cn("relative flex w-fit rounded-full border-2 border-black bg-white p-1", className)}
      onMouseLeave={restOnActive}
    >
      {items.map((it) => (
        <Tab key={it.value} item={it} active={it.value === value} setPosition={setPosition} onChange={onChange}
          liRef={(el) => { refs.current[it.value] = el; }} />
      ))}
      <Cursor position={position} />
    </ul>
  );
}

const Tab = ({ item, active, setPosition, onChange, liRef }: {
  item: Item; active: boolean; setPosition: (p: Pos) => void; onChange?: (v: string) => void; liRef: (el: HTMLLIElement | null) => void;
}) => {
  const ref = useRef<HTMLLIElement | null>(null);
  return (
    <li
      ref={(el) => { ref.current = el; liRef(el); }}
      onMouseEnter={() => {
        if (!ref.current) return;
        const { width } = ref.current.getBoundingClientRect();
        setPosition({ width, opacity: 1, left: ref.current.offsetLeft });
      }}
      className="relative z-10 block shrink-0 text-white mix-blend-difference"
    >
      <a
        href={item.href || `#${item.value}`}
        aria-current={active ? "page" : undefined}
        onClick={(e) => { if (onChange) { e.preventDefault(); onChange(item.value); } }}
        className="block cursor-pointer whitespace-nowrap px-[7px] py-1.5 text-[11.5px] font-medium uppercase tracking-normal lg:px-2.5 lg:text-[12px] 2xl:px-4 2xl:py-2 2xl:text-sm 2xl:tracking-wide"
      >
        {item.label}
      </a>
    </li>
  );
};

const Cursor = ({ position }: { position: Pos }) => (
  <motion.li animate={position} transition={{ type: "spring", stiffness: 500, damping: 40 }} className="absolute top-1 z-0 h-[calc(100%-0.5rem)] rounded-full bg-black" aria-hidden />
);

export default NavHeader;
export { NavHeader };
