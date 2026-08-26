import { ImageResponse } from "next/og";

/**
 * The social preview card.
 *
 * This link is pasted into LinkedIn, Upwork and a CV, and without an image
 * those all render a grey box with a title in it. Generated rather than drawn
 * so it cannot drift from the numbers: everything on it is a fact the run
 * records already carry.
 *
 * Colours are the theme's dark palette written as hex, because Satori — the
 * renderer behind ImageResponse — has no oklch(). They correspond to
 * --background, --foreground and --chart-1 in globals.css.
 */
export const alt = "agentscore — an evaluation harness for computer-use agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * One weight only.
 *
 * ImageResponse ships a single regular face of Noto Sans and nothing else, so
 * `fontWeight: 700` renders identically to no fontWeight at all — it was here,
 * it did nothing, and it read as a bug when the card came out lighter than
 * intended. Hierarchy comes from size and colour instead. Anyone wanting real
 * bold has to pass a font buffer to ImageResponse; do that or leave weights
 * out, but do not declare one and assume it landed.
 */
const INK = "#FAFAF9";
const GROUND = "#1C1917";
const MUTED = "#A8A29E";
const ACCENT = "#3B82F6";

/** Deliberately the committed totals, not rounded ones. */
const FACTS = [
  { value: "48", label: "recorded runs" },
  { value: "5 × 6 × 2", label: "models, tasks, action spaces" },
  { value: "$0.65", label: "total model spend" },
];

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: GROUND,
          padding: "72px 76px 64px",
          position: "relative",
        }}
      >
        {/* The same accent bar the project cards on the portfolio wear. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: 10,
            background: `linear-gradient(90deg, ${ACCENT}, rgba(59,130,246,0))`,
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: ACCENT }} />
          <div style={{ fontSize: 22, color: MUTED, letterSpacing: 1.6 }}>
            GITHUB.COM/IAMWALEEDIQBAL/AGENTSCORE
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 104, color: INK, letterSpacing: -3 }}>
            agentscore
          </div>
          <div style={{ marginTop: 18, fontSize: 36, color: MUTED, lineHeight: 1.35, maxWidth: 900 }}>
            Drive an agent against a live application, and grade the state it leaves behind —
            never the route it took.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 56 }}>
          {FACTS.map((fact) => (
            <div key={fact.label} style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 52, color: ACCENT, letterSpacing: -1.5 }}>
                {fact.value}
              </div>
              <div style={{ marginTop: 6, fontSize: 24, color: MUTED }}>{fact.label}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
