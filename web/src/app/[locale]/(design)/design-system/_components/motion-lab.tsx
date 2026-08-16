"use client";

import { useState } from "react";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import {
  duration,
  easing,
  expressiveIn,
  fadeUp,
  spring,
  staggerContainer,
  useReducedMotion,
} from "@/lib/motion";

const ROWS = ["Ana Diallo", "Karim Bensaïd", "Lina Touré", "Yanis Ferhat"];

/**
 * Banc d'essai du vocabulaire de mouvement.
 *
 * Le bouton rejoue les figures : une animation qu'on ne peut déclencher qu'en
 * rechargeant la page est une animation qu'on ne relit jamais en revue.
 */
export function MotionLab() {
  const [run, setRun] = useState(0);
  const reduced = useReducedMotion();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setRun((value) => value + 1)}>
          Rejouer les animations
        </Button>
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {reduced
            ? "prefers-reduced-motion actif — les déplacements sont neutralisés."
            : "Mouvement complet."}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <figure className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <figcaption className="mb-3 text-xs font-medium text-muted-foreground">
            fadeUp — entrée standard
          </figcaption>
          <motion.div
            key={`fade-${run}`}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="h-16 rounded-md bg-primary"
          />
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            {duration.base}s · emphasized
          </p>
        </figure>

        <figure className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <figcaption className="mb-3 text-xs font-medium text-muted-foreground">
            staggerContainer — liste courte
          </figcaption>
          <motion.ul
            key={`stagger-${run}`}
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="space-y-1.5"
          >
            {ROWS.map((name) => (
              <motion.li
                key={name}
                variants={fadeUp}
                className="rounded-md bg-muted px-3 py-1.5 text-sm"
              >
                {name}
              </motion.li>
            ))}
          </motion.ul>
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            40ms entre enfants
          </p>
        </figure>

        <figure className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <figcaption className="mb-3 text-xs font-medium text-muted-foreground">
            expressiveIn — moment expressif
          </figcaption>
          <motion.div
            key={`expressive-${run}`}
            variants={expressiveIn}
            initial="hidden"
            animate="visible"
            className="grid h-16 place-items-center rounded-md text-sm font-semibold text-primary-foreground"
            style={{ background: "var(--gradient-brand)" }}
          >
            1 248 inscrits
          </motion.div>
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            ressort · bounce {spring.expressive.bounce}
          </p>
        </figure>
      </div>

      <dl className="grid gap-x-8 gap-y-2 rounded-lg border border-border bg-muted/40 p-4 text-sm sm:grid-cols-2">
        {Object.entries(duration).map(([name, value]) => (
          <div key={name} className="flex justify-between gap-4">
            <dt className="font-mono text-xs">duration.{name}</dt>
            <dd className="font-mono text-xs text-muted-foreground">
              {value}s
            </dd>
          </div>
        ))}
        {Object.entries(easing).map(([name, value]) => (
          <div key={name} className="flex justify-between gap-4">
            <dt className="font-mono text-xs">easing.{name}</dt>
            <dd className="font-mono text-xs text-muted-foreground">
              [{value.join(", ")}]
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
