import { useAnimation, useReducedMotion, type Variants } from "motion/react"
import { useCallback, useId, useImperativeHandle, useRef, type MouseEvent, type Ref } from "react"

type GridIconHandle = { startAnimation: () => void; stopAnimation: () => void }

// Shared implementation from the existing LayoutGridIcon/TableGridIcon pair.
// Geometry stays with each icon; timing, controls and reduced-motion policy have one owner.
export function useGridIconAnimation({ ref, duration, isAnimated, onMouseEnter, onMouseLeave }: {
  ref: Ref<GridIconHandle>
  duration: number
  isAnimated: boolean
  onMouseEnter?: (event: MouseEvent<HTMLDivElement>) => void
  onMouseLeave?: (event: MouseEvent<HTMLDivElement>) => void
}) {
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
   (e: MouseEvent<HTMLDivElement>) => {
    if (!isAnimated || reduced) return;
    if (!isControlled.current) controls.start("animate");
    else onMouseEnter?.(e);
   },
   [controls, reduced, isAnimated, onMouseEnter],
  );

  const handleLeave = useCallback(
   (e: MouseEvent<HTMLDivElement>) => {
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

  return { gradientId, controls, handleEnter, handleLeave, gridVariants, tileVariants, sweepVariants }
}
