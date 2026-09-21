// Adapted from https://animateicons.in/r/lu-layout-grid.json (MIT).
// User requested a 3x3 table grid with the same staggered tile animation.
"use client";

import { cn } from "@/lib/utils";
import type { Variants } from "motion/react";
import {
 LazyMotion,
 domMin,
 m,
 useAnimation,
 useReducedMotion,
} from "motion/react";
import {
 forwardRef,
 useCallback,
 useImperativeHandle,
 useRef,
 useId,
 type HTMLAttributes,
} from "react";
export interface TableGridIconHandle {
 startAnimation: () => void;
 stopAnimation: () => void;
}

interface TableGridIconProps extends Omit<
 HTMLAttributes<HTMLDivElement>,
 | "color"
 | "onDrag"
 | "onDragStart"
 | "onDragEnd"
 | "onAnimationStart"
 | "onAnimationEnd"
 | "onAnimationIteration"
> {
 size?: number;
 duration?: number;
 isAnimated?: boolean;
 color?: string;
}

const TableGridIcon = forwardRef<TableGridIconHandle, TableGridIconProps>(
 (
  {
   onMouseEnter,
   onMouseLeave,
   className,
   size = 24,
   duration = 1,
   isAnimated = true,
   color,
   ...props
  },
  ref,
 ) => {
  const gradientId = useId();
  const controls = useAnimation();
  const reduced = useReducedMotion();
  const isControlled = useRef(false);

  useImperativeHandle(ref, () => {
   isControlled.current = true;
   return {
    startAnimation: () =>
     reduced ? controls.start("normal") : controls.start("animate"),
    stopAnimation: () => controls.start("normal"),
   };
  });

  const handleEnter = useCallback(
   (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isAnimated || reduced) return;
    if (!isControlled.current) controls.start("animate");
    else onMouseEnter?.(e);
   },
   [controls, reduced, isAnimated, onMouseEnter],
  );

  const handleLeave = useCallback(
   (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isControlled.current) {
     controls.start("normal");
    } else onMouseLeave?.(e);
   },
   [controls, onMouseLeave],
  );

  const gridVariants: Variants = {
   normal: { scale: 1, rotate: 0 },
   animate: {
    scale: [1, 1.03, 1],
    rotate: [0, 1, 0],
    transition: {
     duration: 0.6 * duration,
     ease: "easeInOut" as const,
    },
   },
  };

  const tileVariants: Variants = {
   normal: { opacity: 1, scale: 1 },
   animate: (i: number) => ({
    opacity: [0.4, 1],
    scale: [0.85, 1.08, 1],
    transition: {
     duration: 0.55 * duration,
     delay: 0.08 * i,
     ease: "easeOut" as const,
    },
   }),
  };

  const sweepVariants: Variants = {
   normal: { x: -26, y: -26, opacity: 0 },
   animate: {
    x: [-26, 26],
    y: [-26, 26],
    opacity: [0, 0.35, 0],
    transition: {
     duration: 0.8 * duration,
     ease: "easeInOut" as const,
     delay: 0.1,
    },
   },
  };

  return (
   <LazyMotion features={domMin} strict>
    <m.div
     className={cn("inline-flex items-center justify-center", className)}
     onMouseEnter={handleEnter}
     onMouseLeave={handleLeave}
     {...props}
     style={{ color, ...props.style }}
    >
     <m.svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="lucide table-grid-icon"
     >
      <defs>
       <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
        <stop offset="50%" stopColor="currentColor" stopOpacity="0.35" />
        <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
       </linearGradient>
      </defs>

      <m.g variants={gridVariants} initial="normal" animate={controls}>
       {Array.from({ length: 9 }, (_, index) => {
        const row = Math.floor(index / 3);
        const column = index % 3;
        const x = 3 + column * 6;
        const y = 3 + row * 6;
        const right = x + 6;
        const bottom = y + 6;
        // Round only the four outer corners; internal cells keep shared straight edges.
        const tl = row === 0 && column === 0 ? 2 : 0;
        const tr = row === 0 && column === 2 ? 2 : 0;
        const br = row === 2 && column === 2 ? 2 : 0;
        const bl = row === 2 && column === 0 ? 2 : 0;
        const outline = [
         `M ${x + tl} ${y} H ${right - tr}`,
         `Q ${right} ${y} ${right} ${y + tr} V ${bottom - br}`,
         `Q ${right} ${bottom} ${right - br} ${bottom} H ${x + bl}`,
         `Q ${x} ${bottom} ${x} ${bottom - bl} V ${y + tl}`,
         `Q ${x} ${y} ${x + tl} ${y} Z`,
        ].join(" ");
        return (
         <m.path
          key={index}
          d={outline}
          strokeWidth={1.5}
          variants={tileVariants}
          custom={row + column}
          initial="normal"
          animate={controls}
         />
        );
       })}

       <m.rect
        x="2"
        y="2"
        width="20"
        height="20"
        rx="3"
        fill={`url(#${gradientId})`}
        variants={sweepVariants}
        initial="normal"
        animate={controls}
        style={{ pointerEvents: "none" }}
       />
      </m.g>
     </m.svg>
    </m.div>
   </LazyMotion>
  );
 },
);

TableGridIcon.displayName = "TableGridIcon";
export { TableGridIcon };
