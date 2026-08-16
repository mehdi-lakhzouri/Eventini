"use client";

import { motion } from "motion/react";

import {
  typewriterCharacter,
  typewriterContainer,
  useReducedMotion,
} from "@/lib/motion";
import { cn } from "@/lib/utils";

type TypewriterTextProps = {
  lines: readonly string[];
  delay?: number;
  className?: string;
};

/**
 * Effet de saisie visuel. La phrase complète reste exposée d'un bloc aux
 * technologies d'assistance, qui n'ont donc pas à annoncer chaque lettre.
 */
export function TypewriterText({
  lines,
  delay = 0,
  className,
}: TypewriterTextProps) {
  const reduceMotion = useReducedMotion();
  const accessibleText = lines.join(" ");

  if (reduceMotion) {
    return (
      <span className={className} aria-label={accessibleText}>
        {lines.map((line, lineIndex) => (
          <span key={line}>
            {line}
            {lineIndex < lines.length - 1 ? <br /> : null}
          </span>
        ))}
      </span>
    );
  }

  return (
    <motion.span
      className={cn("inline-block", className)}
      aria-label={accessibleText}
      initial="hidden"
      animate="visible"
      custom={delay}
      variants={typewriterContainer}
    >
      {lines.map((line, lineIndex) => (
        <span key={line} aria-hidden="true">
          {Array.from(line).map((character, characterIndex) => (
            <motion.span
              key={`${lineIndex}-${characterIndex}`}
              variants={typewriterCharacter}
            >
              {character}
            </motion.span>
          ))}
          {lineIndex < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </motion.span>
  );
}
