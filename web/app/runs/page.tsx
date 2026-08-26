// A server component whose only job is the browser-tab title. The console
// itself is a client component: without this split the layout's
// `%s — agentscore` template never fires and the tab just reads "agentscore".
import { RunsConsole } from "./runs-console";

export const metadata = { title: "Runs" };

export default function Page() {
  return <RunsConsole />;
}
