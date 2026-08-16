"use client";

import * as React from "react";
import {
  AnimatePresence,
  motion,
  type HTMLMotionProps,
  type Transition,
} from "motion/react";

import {
  ToggleGroup as BaseToggleGroup,
  ToggleGroupItem as BaseToggleGroupItem,
} from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

type MotionToggleGroupContextValue = {
  type?: "single" | "multiple";
  transition?: Transition;
  activeClassName?: string;
  globalId: string;
};

const MotionToggleGroupContext =
  React.createContext<MotionToggleGroupContextValue | null>(null);

function useMotionToggleGroup() {
  const context = React.useContext(MotionToggleGroupContext);

  if (context === null) {
    throw new Error("ToggleGroupItem must be rendered inside ToggleGroup");
  }

  return context;
}

export type MotionToggleGroupProps = React.ComponentProps<
  typeof BaseToggleGroup
> & {
  type?: "single" | "multiple";
  transition?: Transition;
  activeClassName?: string;
};

function ToggleGroup({
  className,
  variant,
  size,
  children,
  type,
  transition = { type: "spring", bounce: 0, stiffness: 240, damping: 28 },
  activeClassName,
  value,
  defaultValue,
  onValueChange,
  ...props
}: MotionToggleGroupProps) {
  const globalId = React.useId();
  const isSingle = type === "single";
  const [uncontrolledSingleValue, setUncontrolledSingleValue] =
    React.useState<readonly string[]>(
    defaultValue ?? value ?? [],
    );
  const singleValue = value ?? uncontrolledSingleValue;

  const handleSingleValueChange = React.useCallback(
    (
      nextValues: string[],
      eventDetails: Parameters<
        NonNullable<
          React.ComponentProps<typeof BaseToggleGroup>["onValueChange"]
        >
      >[1],
    ) => {
      // A single-choice appearance control must always retain one selection.
      if (nextValues.length === 0) {
        return;
      }

      const next = [nextValues.at(-1) as string];
      if (value === undefined) {
        setUncontrolledSingleValue(next);
      }
      onValueChange?.(next, eventDetails);
    },
    [onValueChange, value],
  );

  return (
    <MotionToggleGroupContext.Provider
      value={{ type, transition, activeClassName, globalId }}
    >
      <BaseToggleGroup
        className={cn("relative", className)}
        variant={variant}
        size={size}
        value={isSingle ? singleValue : value}
        defaultValue={isSingle ? undefined : defaultValue}
        onValueChange={isSingle ? handleSingleValueChange : onValueChange}
        {...props}
      >
        {children}
      </BaseToggleGroup>
    </MotionToggleGroupContext.Provider>
  );
}

export type MotionToggleGroupItemProps = React.ComponentProps<
  typeof BaseToggleGroupItem
> & {
  children?: React.ReactNode;
  motionProps?: HTMLMotionProps<"div">;
  spanProps?: React.ComponentProps<"span">;
};

function ToggleGroupItem({
  ref,
  className,
  children,
  motionProps,
  spanProps,
  ...props
}: MotionToggleGroupItemProps) {
  const { activeClassName, transition, type, globalId } =
    useMotionToggleGroup();
  const itemRef = React.useRef<HTMLButtonElement | null>(null);
  const [isActive, setIsActive] = React.useState(false);

  React.useImperativeHandle(ref, () => itemRef.current as HTMLButtonElement);

  React.useEffect(() => {
    const node = itemRef.current;

    if (node === null) {
      return;
    }

    const updatePressedState = () => setIsActive(node.dataset.pressed !== undefined);
    const observer = new MutationObserver(updatePressedState);

    observer.observe(node, {
      attributes: true,
      attributeFilter: ["data-pressed"],
    });
    updatePressedState();

    return () => observer.disconnect();
  }, []);

  return (
    <BaseToggleGroupItem
      ref={itemRef}
      {...props}
      className={cn(
        "relative hover:bg-transparent data-pressed:bg-transparent",
        className,
      )}
    >
      <motion.div
        data-slot="toggle-group-item-motion"
        initial={{ scale: 1 }}
        whileTap={{ scale: 0.9 }}
        {...motionProps}
        className={cn(
          "relative flex h-full w-full items-center justify-center",
          motionProps?.className,
        )}
      >
        <span
          {...spanProps}
          data-state={isActive ? "on" : "off"}
          className={cn("relative z-1", spanProps?.className)}
        >
          {children}
        </span>

        <AnimatePresence initial={false}>
          {isActive && type === "single" ? (
            <motion.span
              layoutId={`active-toggle-group-item-${globalId}`}
              data-slot="active-toggle-group-item"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transition}
              className={cn(
                "absolute inset-0 z-0 rounded-md bg-muted",
                activeClassName,
              )}
            />
          ) : null}
        </AnimatePresence>
      </motion.div>
    </BaseToggleGroupItem>
  );
}

export { ToggleGroup, ToggleGroupItem };
