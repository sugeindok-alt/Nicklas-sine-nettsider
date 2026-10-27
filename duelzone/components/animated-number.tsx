"use client";
import { useEffect, useRef } from "react";
import { animate, useReducedMotion } from "motion/react";
export function AnimatedNumber({ value }: { value: number }) {
  const node = useRef<HTMLSpanElement>(null),
    previous = useRef(value),
    reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) {
      if (node.current) node.current.textContent = value.toLocaleString();
      previous.current = value;
      return;
    }
    const controls = animate(previous.current, value, {
      duration: 0.25,
      ease: "easeOut",
      onUpdate: (n) => {
        previous.current = n;
        if (node.current)
          node.current.textContent = (
            Number.isInteger(value) ? Math.round(n) : Math.round(n * 10) / 10
          ).toLocaleString();
      },
    });
    return () => controls.stop();
  }, [value, reduced]);
  return <span ref={node}>{value.toLocaleString()}</span>;
}
