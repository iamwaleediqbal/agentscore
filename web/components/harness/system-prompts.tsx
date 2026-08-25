import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SCREEN, computerPrompt } from "@/lib/environment/computer";
import { SYSTEM_PROMPT } from "@/lib/environment/serialize";

/**
 * The two system prompts, exactly as sent.
 *
 * Rendered from the same constants the runner uses rather than transcribed, so
 * this page cannot describe a prompt the model never saw. A benchmark that
 * paraphrases what it told the model is not reproducible by anyone reading it.
 *
 * Both are generated: the tool-calling one lists the action space from the
 * catalogue, the computer-use one states the geometry of the screenshot it is
 * about to send. Neither contains a URL, and that is deliberate — Playwright
 * navigates to the environment itself, so the page is already open by the time
 * the model is asked anything. Telling it an address it has no way to visit
 * would be a fact it can only be confused by.
 */
export function SystemPrompts() {
  const prompts = [
    {
      value: "computer",
      label: "Computer use",
      note: `Sent with a ${SCREEN.imageWidth}×${SCREEN.imageHeight} screenshot every turn. The model answers in coordinates.`,
      body: computerPrompt(SCREEN),
    },
    {
      value: "tool",
      label: "Tool calling",
      note: "Sent once, then the serialised mailbox each turn. The model answers with a named action.",
      body: SYSTEM_PROMPT,
    },
  ];

  return (
    <Tabs defaultValue="computer" className="w-full">
      <TabsList>
        {prompts.map((p) => (
          <TabsTrigger key={p.value} value={p.value}>
            {p.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {prompts.map((p) => (
        <TabsContent key={p.value} value={p.value} className="mt-3 space-y-2">
          <p className="text-sm text-muted-foreground">{p.note}</p>
          <Card>
            <CardContent className="p-0">
              {/* Wrapped, not scrolled sideways: a prompt read half a line at a
                  time is a prompt nobody checks. */}
              <pre className="max-h-[32rem] overflow-y-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed">
                {p.body}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      ))}
    </Tabs>
  );
}
