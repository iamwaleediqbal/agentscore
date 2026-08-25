"use client";

import { Cpu, FlaskConical, Inbox, ListChecks, Play, Scale, Wrench } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview", Icon: FlaskConical },
  { href: "/models", label: "Models", Icon: Cpu },
  { href: "/tasks", label: "Tasks", Icon: ListChecks },
  { href: "/runs", label: "Runs", Icon: Play },
  { href: "/graders", label: "Graders", Icon: Scale },
  { href: "/tools", label: "Action space", Icon: Wrench },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // The environment is its own application; it must not be wrapped in the
  // harness chrome, or a run would be evaluating a page that does not exist
  // outside this console.
  if (pathname.startsWith("/gym")) return <>{children}</>;

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground">
              <FlaskConical className="size-3.5" />
            </span>
            agentscore
          </Link>
          <Badge variant="secondary" className="hidden font-normal sm:inline-flex">
            agent evaluation
          </Badge>

          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {NAV.map(({ href, label, Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <Button
                  key={href}
                  asChild
                  size="sm"
                  variant={active ? "secondary" : "ghost"}
                  className={cn(!active && "text-muted-foreground")}
                >
                  <Link href={href}>
                    <Icon className="size-3.5" />
                    {label}
                  </Link>
                </Button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
              <Link href="/gym" target="_blank">
                <Inbox className="size-3.5" />
                <span className="hidden sm:inline">Environment</span>
              </Link>
            </Button>
            <ThemeToggle />
          </div>
        </div>

        <nav className="flex items-center gap-1 overflow-x-auto border-t px-4 py-1.5 md:hidden">
          {NAV.map(({ href, label, Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Button
                key={href}
                asChild
                size="sm"
                variant={active ? "secondary" : "ghost"}
                className={cn("shrink-0", !active && "text-muted-foreground")}
              >
                <Link href={href}>
                  <Icon className="size-3.5" />
                  {label}
                </Link>
              </Button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">{children}</main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6">
          <span>
            A compact, public version of the agent evaluation platform I build full time.
          </span>
          <a href="https://github.com/iamwaleediqbal/agentscore" className="hover:text-foreground">
            Source
          </a>
        </div>
      </footer>
    </div>
  );
}
