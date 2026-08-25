import { Eye, FileText } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ACTION_NAMES } from "@/lib/environment/actions";
import { CATALOG, type ActionName, argsOf } from "@/lib/environment/catalog";
import { SystemPrompts } from "@/components/harness/system-prompts";
import { COMPUTER_ACTIONS } from "@/lib/environment/computer";

export const metadata = { title: "Action spaces" };

// The same table the model's prompt is generated from. Two hand-written copies
// is how the page came to advertise a `label` control that did not exist while
// omitting the four that did.
const TOOLS = (Object.keys(CATALOG) as ActionName[]).map((name) => ({
  name,
  // Derived from the same `params` the JSON Schema is built from, so the table
  // a reader sees and the schema the model is sent cannot describe different
  // arguments.
  args: argsOf(CATALOG[name]),
  ...CATALOG[name],
}));
export default function Tools() {
  const missing = ACTION_NAMES.filter((name) => !TOOLS.some((t) => t.name === name));

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          System prompts, exactly as sent
        </h2>
        <p className="max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
          Generated from the same constants the runner uses, so this page cannot show a prompt the
          model never saw. Neither names a URL: the browser is already on the page by the time the
          model is asked anything.
        </p>
        <SystemPrompts />
      </section>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Action spaces</h1>
        <p className="max-w-[80ch] text-sm leading-relaxed text-muted-foreground">
          The same tasks, the same environment and the same grader, reached two different
          ways. Which one a run used is recorded on the run, because a pass rate from one is
          not comparable to a pass rate from the other.
        </p>
      </header>

      {/* --------------------------------------------------- how a turn is sent */}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">How a turn is sent</h2>

        <p className="max-w-[80ch] text-sm leading-relaxed text-muted-foreground">
          Both spaces send their action set as JSON Schema tool definitions and take a tool
          call back — the same transport, so the only difference between them is what the
          model is shown and what it can name. That matters for the comparison: if one space
          replied with a structured call and the other with prose in a message, part of any
          gap between their scores would be the transport rather than the skill.
        </p>

        <p className="max-w-[80ch] text-sm leading-relaxed text-muted-foreground">
          In tool calling the loop closes the way an agent loop is supposed to. The call goes
          out, the environment runs it, and the outcome comes back as a{" "}
          <span className="font-mono text-foreground">tool</span> message paired to that call
          by its <span className="font-mono text-foreground">tool_call_id</span>, carrying the
          mailbox as it now stands. The model can see what it did, not just where it ended up.
          Computer use has no such pairing: each turn is a fresh request, and the result of an
          action is the next screenshot.
        </p>

        <Alert>
          <AlertDescription className="space-y-2">
            <p className="text-sm leading-relaxed">
              <span className="font-medium text-foreground">
                This is not a provider-native computer-use tool.
              </span>{" "}
              Anthropic, OpenAI and Google each ship one, with its own action vocabulary and
              its own coordinate convention. None is reachable through OpenRouter, whose
              surface is the standard chat-completions API with ordinary function calling — so
              a harness going through it declares its own vocabulary. What runs here is a
              declared action space over screenshots, called through real function calling.
            </p>
            <p className="text-sm leading-relaxed">
              The coordinate convention is still a per-model fact, and it is treated as one:
              Gemini answers on a 0&ndash;1000 grid, Anthropic and OpenAI in the pixels of the
              screenshot they were given. A run pins its model&apos;s convention on the first
              turn and records which one it used, because reading one as the other puts every
              click somewhere the model never aimed.
            </p>
          </AlertDescription>
        </Alert>
      </section>

      {/* ------------------------------------------------------ computer use */}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Eye className="size-4 text-primary" aria-hidden />
            Computer use
          </h2>
          <Badge className="font-normal">default</Badge>
        </div>

        <p className="max-w-[80ch] text-sm leading-relaxed text-muted-foreground">
          The model is shown a screenshot and nothing else — no element ids, no serialised
          state, no list of what is on screen — and answers with coordinates. The point is
          hit-tested against the live DOM and driven with a real pointer sequence, so a click
          that lands between two controls activates neither. Finding the control is part of
          the task, which is the part a named-action API does for the model.
        </p>

        <p className="max-w-[80ch] text-sm leading-relaxed text-muted-foreground">
          The screenshot is not one size. Chromium photographs its viewport at{" "}
          <span className="font-mono text-foreground">1180×720</span>, where image pixels and
          CSS pixels coincide. There is one driver and one geometry, which is one fewer
          chance to convert a coordinate wrongly. The driver tells the model the geometry it is actually using
          and converts back with it — assuming a geometry rather than stating it would put every click
          in the top-left quadrant of the other one, which reads exactly like a model that
          cannot aim.
        </p>

        <Card className="overflow-hidden p-0">
          <CardHeader className="border-b px-4 py-3">
            <CardTitle className="text-sm font-semibold">Action reference</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead className="hidden sm:table-cell">Arguments</TableHead>
                    <TableHead>Effect</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {COMPUTER_ACTIONS.map((action) => (
                    <TableRow key={action.name}>
                      <TableCell className="font-mono text-sm font-medium">{action.name}</TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
                        {argsOf(action)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {action.effect}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Alert>
          <AlertDescription className="space-y-2 text-sm leading-relaxed">
            <p>
              <span className="font-medium text-foreground">Coordinates are not one thing.</span>{" "}
              Some models answer in the pixels of the image they were given. Several grounding
              models were trained on a 0–1000 grid regardless of image size. A few answer in
              fractions of the screen. None of them say which.
            </p>
            <p>
              The harness reads the convention off the numbers, converts to CSS pixels, and
              writes down which one it decided on — visible on every action in the timeline as{" "}
              <code className="font-mono text-xs text-foreground">
                (800, 500) 0-1000 grid → (944, 360) px
              </code>
              . Rejecting the other two conventions as malformed would report a working
              grounding model as broken; converting silently would hide a guess inside a
              measurement.
            </p>
          </AlertDescription>
        </Alert>
      </section>

      {/* ------------------------------------------------------ tool calling */}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <FileText className="size-4 text-muted-foreground" aria-hidden />
            Tool calling
          </h2>
          <Badge variant="outline" className="font-normal">
            MCP-style interface
          </Badge>
        </div>

        <p className="max-w-[80ch] text-sm leading-relaxed text-muted-foreground">
          The application exposes its state as structured text and its operations as named
          actions, with ids already resolved. The model still has to decide what to do, but
          not where anything is.
        </p>

        <p className="max-w-[80ch] text-sm leading-relaxed text-muted-foreground">
          Worth naming precisely, because it is easy to mistake for something it is not.
          This is <span className="font-medium text-foreground">not</span> the text
          observation a browser-agent benchmark uses — WebArena and BrowserGym give agents the
          page&apos;s <span className="font-mono text-foreground">accessibility tree</span>,
          extracted from what is rendered, and expose no internal state at all. This is the
          other pattern: an application handing an agent a structured interface, which is what
          an MCP server does. Both are real. They are not the same measurement, and reporting
          one as a baseline for the other would be a category error.
        </p>

        <p className="max-w-[80ch] text-sm leading-relaxed text-muted-foreground">
          So the comparison here is between two ways of integrating an agent with an
          application — through its pixels, or through its interface — not between two
          difficulty settings of the same task. The gap still separates a model that
          misunderstood the task from one that understood it and could not find the control;
          it just also includes everything else that differs between the two.
        </p>

        <p className="max-w-[80ch] text-sm leading-relaxed text-muted-foreground">
          Reachability is still enforced here. A control that only exists in the reading pane
          cannot be used without opening the message, and the reducer applies that for a
          browser driver and a direct call alike.
        </p>

        <Card className="overflow-hidden p-0">
          <CardHeader className="border-b px-4 py-3">
            <CardTitle className="text-sm font-semibold">Action reference</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead className="hidden sm:table-cell">Arguments</TableHead>
                    <TableHead>Reachable from</TableHead>
                    <TableHead>Effect</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {TOOLS.map((tool) => (
                    <TableRow key={tool.name}>
                      <TableCell className="font-mono text-sm font-medium">{tool.name}</TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
                        {tool.args}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={tool.reach === "none" ? "destructive" : "secondary"}
                          className="font-normal"
                        >
                          {tool.reach === "none" ? "not available" : tool.reach}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{tool.effect}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {missing.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Undocumented actions present in the reducer: {missing.join(", ")}
          </p>
        )}
      </section>
    </div>
  );
}
