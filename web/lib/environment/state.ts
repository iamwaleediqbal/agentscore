/**
 * The gym's world.
 *
 * All of it lives in one serialisable object held in localStorage. That is not
 * a shortcut, it is the property the whole grading model depends on: if the
 * entire observable world is one JSON value, then "did the agent do the task"
 * becomes a comparison between two JSON values rather than an argument about
 * what the screen looked like.
 */

export type Folder =
  | "inbox"
  | "drafts"
  | "outbox"
  | "sent"
  | "spam"
  | "archive"
  | "trash";

export const FOLDER_ORDER: Folder[] = [
  "inbox",
  "drafts",
  "outbox",
  "sent",
  "spam",
  "archive",
  "trash",
];

export interface Email {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  receivedAt: string;
  folder: Folder;
  read: boolean;
  starred: boolean;
  labels: string[];
}

export interface MailState {
  emails: Email[];
  selectedId: string | null;
  composer: { to: string; subject: string; body: string } | null;
  /**
   * Which folder is on screen.
   *
   * World state rather than component state, for two reasons. An agent needs a
   * way to navigate — a task about spam is unreachable otherwise — and the
   * observation should describe the folder being looked at rather than the
   * whole mailbox. Serialising all seven every turn cost about three thousand
   * tokens, most of them mail nobody was looking at, and no mail client works
   * that way either.
   */
  folder: Folder;

  /**
   * The search box.
   *
   * View state, not world state: it changes what is on screen and nothing about
   * the mail. Grading ignores it for the same reason it ignores which message is
   * selected — otherwise every agent that searched would be marked as having
   * changed something nobody asked for.
   */
  query: string;
}

export const STORAGE_KEY = "clickmail.mail.v1";

/**
 * Storage namespace for one run.
 *
 * Every evaluation gets its own key, so two runs can never observe each
 * other's mailbox and a previous run cannot leave anything behind for the
 * next one. Opened standalone there is no run id and the app uses the plain
 * key, which is what makes refreshing keep your mail.
 */
export function storageKeyFor(runId?: string | null): string {
  return runId ? `${STORAGE_KEY}.run.${runId}` : STORAGE_KEY;
}

/** Remove every namespaced run key. Called when a run finishes or is abandoned. */
export function clearRunStorage(runId?: string | null): void {
  try {
    if (runId) {
      window.localStorage.removeItem(storageKeyFor(runId));
      return;
    }
    const prefix = `${STORAGE_KEY}.run.`;
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Blocked site data throws; nothing to clean up in that case anyway.
  }
}

/**
 * Bring a restored mailbox up to the current shape.
 *
 * Local storage holds whatever version of this app last wrote it. `query` was
 * added after people already had mailboxes saved, and reading it straight back
 * gave `undefined` where a string was declared — which took the whole
 * environment down on the first render rather than degrading.
 *
 * Anything persisted across a schema change needs this. The alternative is a
 * new storage key on every change, which silently discards the user's mail.
 */
export function hydrate(raw: unknown): MailState {
  const saved = (raw ?? {}) as Partial<MailState>;
  const fresh = seedState();
  return {
    emails: Array.isArray(saved.emails) && saved.emails.length ? saved.emails : fresh.emails,
    selectedId: typeof saved.selectedId === "string" ? saved.selectedId : null,
    composer: saved.composer ?? null,
    folder: FOLDER_ORDER.includes(saved.folder as Folder) ? (saved.folder as Folder) : "inbox",
    query: typeof saved.query === "string" ? saved.query : "",
  };
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Filler mail. Present so the task's message is not the first thing on screen. */
function note(
  id: string,
  from: string,
  subject: string,
  body: string,
  receivedAt: string,
  read: boolean,
  extra: Partial<Email> = {},
): Email {
  return {
    id,
    from,
    to: "you@clickmail.example",
    subject,
    body,
    receivedAt,
    folder: "inbox",
    read,
    starred: false,
    labels: [],
    ...extra,
  };
}

export function seedState(): MailState {
  return {
    selectedId: null,
    composer: null,
    folder: "inbox",
    query: "",
    emails: [
      /*
       * A working mailbox: fifty-two messages across seven folders, read and
       * unread mixed, a few starred, some already labelled, spam that looks
       * like real mail, drafts half-written, and one message stuck in the
       * outbox. The messages a task is about sit among the rest rather than at
       * the top, so finding the right one is part of the work.
       *
       * Ids carry meaning only to the fixtures: m* are referenced by tasks,
       * everything else is scenery.
       */

      // ---------------------------------------------------------- inbox
      note("i1", "standup@internal.example", "Standup notes, Thursday",
        "Backend is unblocked. Two tickets moved to review.", "2026-08-22T09:05:00Z", true),
      note("i2", "security@internal.example", "New sign-in from a new device",
        "A sign-in was recorded from Lahore. If this was you, no action is needed.",
        "2026-08-22T08:58:00Z", false, { starred: true }),
      note("i3", "cfp@devconf.example", "Your talk proposal was received",
        "Thanks for submitting. Reviews go out in three weeks.",
        "2026-08-22T08:51:00Z", true, { labels: ["speaking"] }),
      note("i4", "sam@quaystreet.example", "Contract renewal, October",
        "Sending the renewal pack next week. Nothing needed from you yet.",
        "2026-08-22T08:44:00Z", false),
      {
        id: "m2",
        from: "noreply@dispatch.example",
        to: "you@clickmail.example",
        subject: "Your order has shipped",
        body: "Order 55-2210 is on its way. Tracking: DX9920114.",
        receivedAt: "2026-08-22T08:40:00Z",
        folder: "inbox",
        read: true,
        starred: false,
        labels: [],
      },
      note("i5", "design@internal.example", "Review requested: settings redesign",
        "Two flows changed. Comments welcome before Monday.", "2026-08-22T08:31:00Z", false),
      note("i6", "billing@quaystreet.example", "Invoice QS-4471 for July",
        "Attached is invoice QS-4471. Payment is not due until 30 September.",
        "2026-08-22T08:22:00Z", true),
      {
        id: "m1",
        from: "ayesha@northwind.example",
        to: "you@clickmail.example",
        subject: "Invoice INV-2026-0871 is overdue",
        body:
          "Hi,\n\nOur records show INV-2026-0871 for PKR 45,000 is 12 days " +
          "overdue. Could you confirm when payment will be released?\n\nAyesha",
        receivedAt: "2026-08-22T08:14:00Z",
        folder: "inbox",
        read: false,
        starred: false,
        labels: [],
      },
      note("i7", "social@internal.example", "Team lunch on Friday",
        "Booked for 13:00. Reply if you have a dietary requirement.",
        "2026-08-22T08:03:00Z", true),
      {
        id: "m3",
        from: "hiring@brightlane.example",
        to: "you@clickmail.example",
        subject: "Interview scheduling",
        body:
          "Are you free Thursday at 15:00 or Friday at 11:00 for a technical " +
          "conversation? Either works for us.",
        receivedAt: "2026-08-22T07:55:00Z",
        folder: "inbox",
        read: false,
        starred: false,
        labels: [],
      },
      note("i8", "it@internal.example", "Your password expires in 7 days",
        "Change it from the account settings page before it lapses.",
        "2026-08-22T07:44:00Z", false),
      {
        id: "m4",
        from: "newsletter@weeklybytes.example",
        to: "you@clickmail.example",
        subject: "Weekly Bytes #212",
        body: "Five things worth reading this week.",
        receivedAt: "2026-08-22T07:30:00Z",
        folder: "inbox",
        read: false,
        starred: false,
        labels: [],
      },
      note("i9", "maya@clientside.example", "Feedback on the latest build",
        "The export is much faster. One rendering issue on Safari, details inside.",
        "2026-08-22T07:12:00Z", false, { starred: true }),
      note("i10", "scrum@internal.example", "Retro moved to Wednesday",
        "Same link, one day earlier.", "2026-08-22T06:58:00Z", true),
      note("i11", "support@ledgerly.example", "Your monthly statement is ready",
        "August statement available in the portal.", "2026-08-22T06:31:00Z", true),
      note("i12", "rota@internal.example", "On-call rota for September",
        "You are second on-call in week 38.", "2026-08-22T06:10:00Z", false),
      note("i13", "noreply@calendarly.example", "Reminder: 1:1 tomorrow 10:00",
        "With your manager. Agenda link inside.", "2026-08-22T05:52:00Z", true),
      note("i14", "kate@brightlane.example", "Directions for Thursday",
        "Reception is on the second floor. Ask for me at the desk.",
        "2026-08-22T05:20:00Z", false),

      // ---------------------------------------------------------- drafts
      note("d1", "you@clickmail.example", "Re: Review requested: settings redesign",
        "Looks good overall. Two notes on the empty state —",
        "2026-08-22T08:35:00Z", true, { folder: "drafts", to: "design@internal.example" }),
      note("d2", "you@clickmail.example", "Q3 planning thoughts",
        "Rough notes before Monday. Not finished.",
        "2026-08-21T17:40:00Z", true, { folder: "drafts", to: "lead@internal.example" }),
      note("d3", "you@clickmail.example", "Re: Contract renewal, October",
        "Thanks Sam — one question about the support tier",
        "2026-08-21T14:02:00Z", true, { folder: "drafts", to: "sam@quaystreet.example" }),
      note("d4", "you@clickmail.example", "", "", "2026-08-20T09:15:00Z", true,
        { folder: "drafts", to: "" }),

      // ---------------------------------------------------------- outbox
      note("o1", "you@clickmail.example", "Re: On-call rota for September",
        "Confirmed for week 38.", "2026-08-22T09:02:00Z", true,
        { folder: "outbox", to: "rota@internal.example" }),
      note("o2", "you@clickmail.example", "Expenses for August",
        "Receipts attached.", "2026-08-22T08:55:00Z", true,
        { folder: "outbox", to: "expenses@internal.example" }),

      // ---------------------------------------------------------- sent
      note("s1", "you@clickmail.example", "Re: Feedback on the latest build",
        "Thanks — I have logged the Safari issue and will look this week.",
        "2026-08-21T15:02:00Z", true, { folder: "sent", to: "maya@clientside.example" }),
      note("s2", "you@clickmail.example", "Re: Standup notes, Wednesday",
        "Nothing blocking on my side.", "2026-08-21T09:40:00Z", true,
        { folder: "sent", to: "standup@internal.example" }),
      note("s3", "you@clickmail.example", "Re: Invoice QS-4471 for July",
        "Received, thank you. Scheduled for the September run.",
        "2026-08-20T16:18:00Z", true, { folder: "sent", to: "billing@quaystreet.example" }),
      note("s4", "you@clickmail.example", "Availability for next week",
        "Free Tuesday and Thursday afternoon.", "2026-08-20T11:05:00Z", true,
        { folder: "sent", to: "kate@brightlane.example" }),
      note("s5", "you@clickmail.example", "Re: Your talk proposal was received",
        "Thanks for confirming.", "2026-08-19T18:22:00Z", true,
        { folder: "sent", to: "cfp@devconf.example" }),
      note("s6", "you@clickmail.example", "Handover notes",
        "Everything is in the shared drive under August.",
        "2026-08-19T10:47:00Z", true, { folder: "sent", to: "lead@internal.example" }),

      // ---------------------------------------------------------- spam
      // Mostly junk, plus one message that should never have been filed here.
      note("p1", "billing@northwind-secure.example",
        "URGENT: verify your account within 24 hours",
        "Your account will be suspended. Confirm your card details at the link " +
        "below to avoid interruption. This is your final notice.",
        "2026-08-22T08:47:00Z", false, { folder: "spam" }),
      note("p2", "winner@prizedraw.example", "You have been selected",
        "Claim your reward within 48 hours.", "2026-08-22T04:10:00Z", false, { folder: "spam" }),
      note("p3", "offers@dealstack.example", "70% off, today only",
        "Our biggest sale of the year.", "2026-08-21T22:30:00Z", false, { folder: "spam" }),
      {
        id: "m5",
        from: "accounts@brightlane.example",
        to: "you@clickmail.example",
        subject: "Signed contract for the September engagement",
        body:
          "Hi,\n\nAttaching the countersigned agreement for September. Please keep " +
          "this for your records — it is the only signed copy.\n\nKate",
        receivedAt: "2026-08-21T19:05:00Z",
        folder: "spam",
        read: false,
        starred: false,
        labels: [],
      },
      note("p4", "no-reply@cryptoboost.example", "Double your holdings this week",
        "Guaranteed returns. Limited places.", "2026-08-21T15:44:00Z", false, { folder: "spam" }),
      {
        id: "m6",
        from: "security@rnetbank.example",
        to: "you@clickmail.example",
        subject: "Unusual activity on your account",
        body:
          "We have detected unusual activity. Verify your identity immediately at " +
          "the link below or your account will be frozen within one hour.",
        receivedAt: "2026-08-21T12:19:00Z",
        folder: "spam",
        read: false,
        starred: false,
        labels: [],
      },
      note("p5", "hello@seoexperts.example", "Rank #1 on Google",
        "We can get your site to the top.", "2026-08-20T20:02:00Z", false, { folder: "spam" }),
      note("p6", "info@luckyspin.example", "Your spin is ready",
        "One free spin remaining.", "2026-08-20T08:31:00Z", false, { folder: "spam" }),
      note("p7", "newsletter@adtracker.example", "We miss you",
        "Come back for 20% off.", "2026-08-19T13:55:00Z", true, { folder: "spam" }),

      // ---------------------------------------------------------- archive
      note("a1", "hr@internal.example", "Signed: updated contract",
        "Countersigned copy attached for your records.",
        "2026-08-21T16:20:00Z", true, { folder: "archive", labels: ["admin"] }),
      note("a2", "noreply@dispatch.example", "Order 54-8817 delivered",
        "Left with reception.", "2026-08-21T12:05:00Z", true, { folder: "archive" }),
      note("a3", "payroll@internal.example", "July payslip",
        "Available in the portal.", "2026-08-20T09:00:00Z", true,
        { folder: "archive", labels: ["admin"] }),
      note("a4", "maya@clientside.example", "Kickoff notes",
        "Summary of what we agreed in the kickoff call.",
        "2026-08-19T14:30:00Z", true, { folder: "archive" }),
      note("a5", "devconf@devconf.example", "Your ticket for DevConf",
        "QR code attached.", "2026-08-18T11:11:00Z", true, { folder: "archive" }),
      note("a6", "it@internal.example", "Laptop collection scheduled",
        "Wednesday morning, desk 12.", "2026-08-18T08:05:00Z", true, { folder: "archive" }),
      note("a7", "sam@quaystreet.example", "Welcome aboard",
        "Delighted to be working together.", "2026-08-17T16:40:00Z", true,
        { folder: "archive", starred: true }),
      note("a8", "standup@internal.example", "Standup notes, Monday",
        "Two items carried over.", "2026-08-17T09:03:00Z", true, { folder: "archive" }),

      // ---------------------------------------------------------- trash
      note("t1", "offers@dealstack.example", "You have won a gift card",
        "Claim within 48 hours.", "2026-08-20T19:44:00Z", true, { folder: "trash" }),
      note("t2", "noreply@surveys.example", "How did we do?",
        "Two-minute survey.", "2026-08-20T10:12:00Z", true, { folder: "trash" }),
      note("t3", "events@devconf.example", "Last call for workshops",
        "Places remaining in three sessions.", "2026-08-19T17:25:00Z", true,
        { folder: "trash" }),
      note("t4", "noreply@dispatch.example", "Order 53-1120 delivered",
        "Left in the porch.", "2026-08-18T15:50:00Z", true, { folder: "trash" }),
      note("t5", "digest@weeklybytes.example", "Weekly Bytes #211",
        "Last week's five things.", "2026-08-15T07:30:00Z", true, { folder: "trash" }),
    ],
  };
}
