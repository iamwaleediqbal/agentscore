// A server component whose only job is the browser-tab title. The console
// itself is a client component: without this split the layout's
// `%s — agentscore` template never fires and the tab just reads "agentscore".
import { RunDetailConsole } from "./run-detail";

export const metadata = { title: "Run" };

export default function Page() {
  return <RunDetailConsole />;
}
