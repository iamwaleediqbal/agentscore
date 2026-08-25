import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { LEADERBOARD, ranked } from "@/lib/harness/leaderboard";

export const metadata: Metadata = {
  title: "Models",
  description: "Free-model pass rates with confidence intervals, and ties left as ties.",
};

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function Models() {
  const rows = ranked(LEADERBOARD.models);
  const widest = Math.max(...rows.map((r) => r.model.ci_high - r.model.ci_low));

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Models</h1>
          {LEADERBOARD.sample && <Badge variant="secondary">sample data</Badge>}
        </div>
        <p className="max-w-[70ch] text-muted-foreground">
          {LEADERBOARD.task_count} tasks, each repeated {LEADERBOARD.repeats} times, against free
          models only — which is the question nobody with a budget bothers to answer. Pass rates
          are shown as intervals because one run is not a result.
        </p>
      </header>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Rank</th>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 font-medium">Pass rate</th>
                <th className="px-4 py-3 font-medium">95% interval</th>
                <th className="px-4 py-3 font-medium tabular">Attempts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ rank, model }, index) => {
                const tied = index > 0 && rows[index - 1]!.rank === rank;
                return (
                  <tr key={model.model} className="border-b last:border-0">
                    <td className="px-4 py-3 tabular text-muted-foreground">
                      {tied ? "=" : rank}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[13px]">{model.model}</span>
                      {tied && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          tied with the row above
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium tabular">{pct(model.pass_rate)}</td>
                    <td className="px-4 py-3">
                      {/* The interval drawn to scale, because "53.8%" and
                          "39–68%" say very different things and only one of
                          them is honest about 39 attempts. */}
                      <div className="flex items-center gap-3">
                        <div className="relative h-1.5 w-32 shrink-0 rounded-full bg-muted">
                          <div
                            className="absolute h-full rounded-full bg-chart-1"
                            style={{
                              left: `${model.ci_low * 100}%`,
                              width: `${Math.max((model.ci_high - model.ci_low) * 100, 2)}%`,
                            }}
                          />
                        </div>
                        <span className="tabular text-xs text-muted-foreground">
                          {pct(model.ci_low)} – {pct(model.ci_high)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular text-muted-foreground">
                      {model.passes}/{model.attempts}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <section className="space-y-3 rounded-lg border bg-muted/30 p-5 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-sm font-semibold text-foreground">How to read this</h2>
        <p>
          <span className="font-medium text-foreground">The interval is the result.</span> Three
          passes out of three is 100% with a lower bound near 44%, which is the correct amount of
          confidence to have in three attempts. The widest interval here spans{" "}
          {pct(widest)} — quoting its midpoint alone would be inventing precision.
        </p>
        <p>
          <span className="font-medium text-foreground">Overlapping intervals share a rank.</span>{" "}
          Ordering them anyway manufactures a difference the data cannot support, and is how a
          leaderboard ends up reordering itself for no reason anyone can explain.
        </p>
        <p>
          <span className="font-medium text-foreground">
            This is not the same measurement as the runs.
          </span>{" "}
          Here a model answers short prompts, many times over. There it operates a live
          application for a dozen turns. A model can be good at one and poor at the other, so the
          two are never averaged together.
        </p>
        <p>
          <span className="font-medium text-foreground">A judge is a last resort.</span>{" "}
          Deterministic checks run first. {LEADERBOARD.judge_model} only sees a task when nothing
          mechanical can settle it, because a judge is a model and brings its own variance on top
          of the variance being measured.
        </p>
      </section>
    </div>
  );
}
