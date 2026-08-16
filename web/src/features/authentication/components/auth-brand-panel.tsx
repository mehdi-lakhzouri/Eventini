"use client";

import { motion } from "motion/react";
import { ShieldCheck, TrendingUp, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { routes } from "@/config/routes";
import {
  authFeatureItem,
  authFeatureList,
  fadeUp,
  useReducedMotion,
} from "@/lib/motion";
import { cn } from "@/lib/utils";
import { EventiniLogo } from "./eventini-logo";
import { TypewriterText } from "./typewriter-text";

const features = [
  {
    icon: UsersRound,
    title: "Gestion centralisée",
    description: "Toutes vos données au même endroit.",
  },
  {
    icon: ShieldCheck,
    title: "Check-in sécurisé",
    description: "Contrôle d’accès fiable et rapide.",
  },
  {
    icon: TrendingUp,
    title: "Suivi en temps réel",
    description: "Des insights à jour pour de meilleures décisions.",
  },
] as const;

export function AuthBrandPanel() {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const initial = reduceMotion ? false : "hidden";

  return (
    <aside className="auth-brand-panel relative hidden min-h-dvh overflow-hidden px-[9%] pb-12 pt-13 text-white lg:block">
      <div
        className="auth-dot-grid auth-dot-grid-top auth-dot-pulse"
        aria-hidden="true"
      />
      <div
        className="auth-dot-grid auth-dot-grid-bottom auth-dot-pulse"
        aria-hidden="true"
      />
      <svg
        className="auth-flow-lines absolute -right-16 top-[8%] h-[92%] w-[72%] opacity-25"
        viewBox="0 0 650 900"
        fill="none"
        aria-hidden="true"
      >
        {Array.from({ length: 13 }).map((_, index) => (
          <path
            key={index}
            d={`M ${640 - index * 13} -40 C ${320 - index * 4} 180, ${260 - index * 8} 330, ${470 - index * 12} 480 S ${700 - index * 17} 760, ${300 - index * 6} 960`}
            stroke="rgba(91, 140, 255, 0.72)"
            strokeWidth="1"
          />
        ))}
      </svg>

      <motion.div initial={initial} animate="visible" variants={fadeUp}>
        <Link
          href={routes.publicHome}
          aria-label="Accueil Eventini"
          className="relative z-10 inline-flex rounded-sm outline-offset-4"
        >
          <EventiniLogo />
        </Link>
      </motion.div>

      <div
        className={cn(
          "relative z-10 max-w-[550px]",
          pathname === routes.forgotPassword || pathname === routes.verifyMfa
            ? "mt-[8vh]"
            : "mt-[11.5vh]",
        )}
      >
        <motion.h1
          initial={initial}
          animate="visible"
          variants={fadeUp}
          className="text-[clamp(3rem,3.45vw,3.625rem)] font-bold leading-[1.28] tracking-[-0.035em]"
        >
          Gérez vos
          <br />
          événements
          <br />
          de bout en bout.
        </motion.h1>

        <TypewriterText
          delay={0.52}
          lines={[
            "Inscriptions, sessions, contrôle d'accès et",
            "rapports réunis dans une seule plateforme.",
          ]}
          className="mt-4.5 text-[clamp(1.05rem,1.24vw,1.25rem)] leading-[1.55] text-white/85"
        />

        <motion.ul
          initial={initial}
          animate="visible"
          variants={authFeatureList}
          className="mt-7.5 space-y-5"
        >
          {features.map(({ icon: Icon, title, description }) => (
            <motion.li
              key={title}
              variants={authFeatureItem}
              className="group flex items-center gap-5"
            >
              <span className="flex size-[68px] shrink-0 items-center justify-center rounded-full bg-[#1748ca]/75 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.035)] transition-[transform,background-color] duration-180 group-hover:scale-[1.04] group-hover:bg-[#1d55dd]/80">
                <Icon className="size-8" strokeWidth={1.6} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <strong className="block text-[1.17rem] font-semibold leading-tight">
                  {title}
                </strong>
                <span className="mt-1 block text-[0.96rem] leading-snug text-white/80">
                  {description}
                </span>
              </span>
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </aside>
  );
}
