"use client";


import { Dashboard } from "@/components/harness/dashboard";
import { RecentRuns } from "@/components/harness/recent-runs";

export default function Overview() {

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Agent evaluation</h1>
        <p className="max-w-[80ch] text-sm leading-relaxed text-muted-foreground">
          An agent is given a task in plain English and turned loose on a live mail
          application. Every task is attempted twice: once reading the screen as a
          screenshot and answering with coordinates — the same leverage a person with a
          mouse has, and no more — and once reading it as text and answering with named
          actions.
        </p>
        <p className="max-w-[80ch] text-sm leading-relaxed text-muted-foreground">
          Grading compares the mailbox it leaves behind against the one a correct solve
          produces, never the route it took: there are many correct routes, and a shorter one
          is not a failure. Doing everything asked <em>and one thing more</em> is a failure,
          and is reported as its own outcome rather than a pass.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          What has been measured
        </h2>
        <Dashboard />
      </section>


      {/* The card carries its own header and a link to the full list, so a
          section heading above it would say the same thing twice. */}
      <RecentRuns limit={6} />
    </div>
  );
}
