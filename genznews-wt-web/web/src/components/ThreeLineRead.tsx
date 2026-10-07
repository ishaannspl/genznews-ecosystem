import type { CSSProperties } from "react";
import { plainText } from "@/lib/plainText";

interface Props {
  lines: string[];
  /** Plays the one load reveal (90ms stagger, once). Off by default. */
  animate?: boolean;
  /** "lg" for the lead story, "sm" for article pages. */
  size?: "lg" | "sm";
  className?: string;
}

/** The signature short read (usually three lines, kept as found): each line on a marker stroke. */
export function ThreeLineRead({ lines, animate = false, size = "sm", className = "" }: Props) {
  // Plain text only: a TL;DR line is markdown, and links or emphasis would read as noise here.
  const items = lines.map(plainText).filter(Boolean);
  if (items.length === 0) return null;
  return (
    <ul
      className={`three-line ${className}`}
      data-size={size}
      data-animate={animate ? "true" : undefined}
      aria-label="Summary in short lines"
    >
      {items.map((line, i) => (
        <li key={i} style={{ "--i": i } as CSSProperties}>
          <span className="marker">{line}</span>
        </li>
      ))}
    </ul>
  );
}
