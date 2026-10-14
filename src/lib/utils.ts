import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// shadcn's class helper: joins conditional classes and lets a later Tailwind
// class override an earlier one of the same kind.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
