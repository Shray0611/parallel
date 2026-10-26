import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "hot" | "warm" | "cold";
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const variants = {
    default: "border-transparent bg-blue-600 text-white shadow hover:bg-blue-700",
    secondary: "border-transparent bg-slate-100 text-slate-900 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100",
    destructive: "border-transparent bg-red-600 text-white shadow hover:bg-red-700",
    outline: "text-slate-950 dark:text-slate-50 border-slate-200 dark:border-slate-800",
    hot: "border-red-200 bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400 dark:border-red-900/60",
    warm: "border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-900/60",
    cold: "border-slate-200 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
