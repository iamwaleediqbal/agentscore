// A server component whose only job is the browser-tab title. The console
// itself is a client component: without this split the layout's
// `%s — agentscore` template never fires and the tab just reads "agentscore".
import { ModelsConsole } from "./models-console";

export const metadata = { title: "Models" };

export default function Page() {
  return <ModelsConsole />;
}
