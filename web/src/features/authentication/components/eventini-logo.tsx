import { cn } from "@/lib/utils";

type EventiniLogoProps = {
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
};

/** Mot-symbole compact, dessiné en SVG pour rester net sur tout écran. */
export function EventiniLogo({
  className,
  markClassName,
  wordmarkClassName,
}: EventiniLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg
        viewBox="0 0 44 44"
        aria-hidden="true"
        className={cn("size-11 shrink-0", markClassName)}
      >
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M14.2 2.5h19.1c4.5 0 7.4 3.4 7.4 7.6v23.8c0 4.2-2.9 7.6-7.4 7.6H14.2c-3.1 0-5.8-1.8-7-4.7L2.5 25.4a8.7 8.7 0 0 1 0-6.8L7.2 7.2a7.5 7.5 0 0 1 7-4.7Zm4.2 9a3 3 0 0 0-3 3v2.7h-2.1a2.2 2.2 0 1 0 0 4.4h2.1v1h-2.1a2.2 2.2 0 1 0 0 4.4h2.1v2.6a3 3 0 0 0 3 3h12.9a2.4 2.4 0 0 0 0-4.8H20.2V27h8.2a2.2 2.2 0 1 0 0-4.4h-8.2v-1h8.2a2.2 2.2 0 1 0 0-4.4h-8.2v-.9h11.1a2.4 2.4 0 0 0 0-4.8H18.4Z"
          clipRule="evenodd"
        />
      </svg>
      <span
        className={cn(
          "text-[2rem] font-semibold leading-none tracking-[-0.055em]",
          wordmarkClassName,
        )}
      >
        eventini
      </span>
    </span>
  );
}
