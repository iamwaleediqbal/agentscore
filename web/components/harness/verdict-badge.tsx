import type { Grade } from "@/lib/harness/grade";
import { metaFor } from "@/lib/harness/verdict-meta";
import { cn } from "@/lib/utils";

/**
 * Status is never carried by colour alone: every verdict ships an icon and a
 * written label, which is also what keeps it legible when the theme flips and
 * what makes a green/amber/red set legitimate where a categorical palette of
 * the same hues would not be.
 *
 * The names come from one shared table, because three components previously
 * held their own and disagreed.
 */
export function VerdictBadge({
  status,
  className,
  size = "default",
  short = false,
}: {
  status: Grade["status"] | null;
  className?: string;
  size?: "default" | "sm";
  /** Use the compact name in tight rows. Still never ambiguous. */
  short?: boolean;
}) {
  const meta = metaFor(status);
  const { Icon } = meta;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 font-medium ring-1",
        size === "sm" ? "text-[11px]" : "text-xs",
        meta.text,
        meta.ring,
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-3" : "size-3.5"} />
      {short ? meta.short : meta.label}
    </span>
  );
}
