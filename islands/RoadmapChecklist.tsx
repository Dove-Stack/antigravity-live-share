import { useState } from "react";

type Status = "shipped" | "in-progress" | "planned";

interface Feature {
  name: string;
  status: Status;
  note: string;
}

const FEATURES: Feature[] = [
  { name: "Client–server connection", status: "shipped", note: "WebSocket relay + auto-reconnect" },
  { name: "Presence (cursors & selections)", status: "shipped", note: "Colored decorations, 150ms throttle" },
  { name: "Glassmorphism session panel", status: "shipped", note: "Webview UI, purple + light grey" },
  { name: "CRDT text sync (Yjs)", status: "shipped", note: "Concurrent-edit safe merging" },
  { name: "Voice chat", status: "shipped", note: "WebRTC data-channel audio, opus, ffmpeg capture" },
  { name: "Live video", status: "shipped", note: "MJPEG frames over the same mesh, glass webview" },
  { name: "Join approval & read-only guests", status: "planned", note: "Host-side access control" },
];

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All" },
  { key: "shipped", label: "Shipped" },
  { key: "planned", label: "Planned" },
];

export default function RoadmapChecklist() {
  const [filter, setFilter] = useState("all");

  const visible =
    filter === "all"
      ? FEATURES
      : FEATURES.filter((f) =>
          filter === "shipped" ? f.status === "shipped" : f.status !== "shipped",
        );

  const shipped = FEATURES.filter((f) => f.status === "shipped").length;
  const percent = Math.round((shipped / FEATURES.length) * 100);

  return (
    <div
      style={{
        padding: "1.25rem",
        borderRadius: "1rem",
        border: "1.5px solid rgba(124,58,237,0.2)",
        background: "rgba(124,58,237,0.05)",
        backdropFilter: "blur(16px)",
        display: "grid",
        gap: "0.75rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <div
          style={{
            flex: 1,
            height: "0.5rem",
            borderRadius: "999px",
            background: "rgba(124,58,237,0.15)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${percent}%`,
              height: "100%",
              borderRadius: "999px",
              background: "linear-gradient(90deg, #7c3aed, #a78bfa)",
              transition: "width 0.4s ease",
            }}
          />
        </div>
        <strong style={{ fontSize: "0.85rem" }}>{percent}%</strong>
      </div>

      <div style={{ display: "flex", gap: "0.4rem" }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            style={{
              padding: "0.25rem 0.75rem",
              borderRadius: "999px",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "pointer",
              border: `1px solid ${filter === f.key ? "#7c3aed" : "rgba(124,58,237,0.3)"}`,
              background:
                filter === f.key ? "rgba(124,58,237,0.18)" : "transparent",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {visible.map((feature) => (
          <li
            key={feature.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.6rem",
              padding: "0.4rem 0",
              borderBottom: "1px solid rgba(124,58,237,0.12)",
              fontSize: "0.9rem",
            }}
          >
            <span>{feature.status === "shipped" ? "🟣" : "⚪"}</span>
            <strong>{feature.name}</strong>
            <span style={{ opacity: 0.6, marginLeft: "auto", fontSize: "0.8rem" }}>
              {feature.note}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
