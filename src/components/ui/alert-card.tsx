// components/ui/alert-card.tsx: the card-8 AlertCard Wan sent (15 Oct 2026),
// with three additions the popup notice needs: `children` (a poster carousel
// under the description), `background` / `foreground` colours chosen in
// Admin, and a scrollable body so a tall poster never pushes the button off
// the screen on a phone.
import * as React from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface AlertCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: React.ReactNode;
  title: string;
  description: string;
  buttonText: string;
  onButtonClick: () => void;
  isVisible: boolean;
  onDismiss?: () => void;
  background?: string;
  foreground?: string;
  children?: React.ReactNode;
}

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 50, scale: 0.95 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 400, damping: 25, staggerChildren: 0.1 } },
  exit: { opacity: 0, y: 20, scale: 0.98, transition: { duration: 0.2 } },
};
const itemVariants: Variants = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } };

const AlertCard = React.forwardRef<HTMLDivElement, AlertCardProps>(
  ({ className, icon, title, description, buttonText, onButtonClick, isVisible, onDismiss, background = "#0b6b3a", foreground = "#ffffff", children, style, ...props }, ref) => (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          ref={ref}
          className={cn("relative w-full max-w-md overflow-hidden rounded-2xl shadow-2xl flex flex-col max-h-[calc(100dvh-2rem)]", className)}
          style={{ background, color: foreground, ...style }}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          role="alertdialog"
          aria-live="assertive"
          aria-label={title}
          {...(props as Record<string, unknown>)}
        >
          {onDismiss && (
            <motion.div variants={itemVariants} className="absolute top-3 right-3 z-10">
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-white/20" style={{ color: foreground }} onClick={onDismiss}>
                <X className="h-4 w-4" />
                <span className="sr-only">Dismiss</span>
              </Button>
            </motion.div>
          )}
          <div className="overflow-y-auto p-5 sm:p-6 pb-0">
            {icon && (
              <motion.div variants={itemVariants} className="mb-2 sm:mb-3 flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-white/15">
                <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}>{icon}</motion.div>
              </motion.div>
            )}
            <motion.h3 variants={itemVariants} className="pr-8 text-lg sm:text-2xl font-bold tracking-tight leading-snug">{title}</motion.h3>
            {description && <motion.p variants={itemVariants} className="mt-2 text-[13px] sm:text-sm leading-snug sm:leading-relaxed whitespace-pre-wrap" style={{ opacity: 0.88 }}>{description}</motion.p>}
            {children && <motion.div variants={itemVariants} className="mt-4">{children}</motion.div>}
          </div>
          <motion.div variants={itemVariants} className="p-5 pt-3 sm:p-6 sm:pt-4">
            <Button
              className="w-full rounded-full py-5 sm:py-6 text-base font-semibold shadow-lg transition-transform duration-200 active:scale-95"
              style={{ background: foreground, color: background }}
              onClick={onButtonClick}
            >
              {buttonText}
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  ),
);
AlertCard.displayName = "AlertCard";

export { AlertCard };
