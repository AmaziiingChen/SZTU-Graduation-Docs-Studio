"use client";

import { useGridIconAnimation } from "@/hooks/use-grid-icon-animation";
import { cn } from "@/lib/utils";
import {
 LazyMotion,
 domMin,
 m,
} from "motion/react";
import {
 forwardRef,
 type HTMLAttributes,
} from "react";
export interface LayoutGridIconHandle {
 startAnimation: () => void;
 stopAnimation: () => void;
}

interface LayoutGridIconProps extends Omit<
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

const LayoutGridIcon = forwardRef<LayoutGridIconHandle, LayoutGridIconProps>(
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
  const { gradientId, controls, handleEnter, handleLeave, gridVariants, tileVariants, sweepVariants } = useGridIconAnimation({ ref, duration, isAnimated, onMouseEnter, onMouseLeave });

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
      className="lucide lucide-layout-grid-icon lucide-layout-grid"
     >
      <defs>
       <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
        <stop offset="50%" stopColor="currentColor" stopOpacity="0.35" />
        <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
       </linearGradient>
      </defs>

      <m.g variants={gridVariants} initial="normal" animate={controls}>
       <m.rect
        width="7"
        height="7"
        x="3"
        y="3"
        rx="1"
        variants={tileVariants}
        custom={0}
        initial="normal"
        animate={controls}
       />
       <m.rect
        width="7"
        height="7"
        x="14"
        y="3"
        rx="1"
        variants={tileVariants}
        custom={1}
        initial="normal"
        animate={controls}
       />
       <m.rect
        width="7"
        height="7"
        x="14"
        y="14"
        rx="1"
        variants={tileVariants}
        custom={2}
        initial="normal"
        animate={controls}
       />
       <m.rect
        width="7"
        height="7"
        x="3"
        y="14"
        rx="1"
        variants={tileVariants}
        custom={3}
        initial="normal"
        animate={controls}
       />

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

LayoutGridIcon.displayName = "LayoutGridIcon";
export { LayoutGridIcon };
