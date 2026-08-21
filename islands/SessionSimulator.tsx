import { useState } from "react";

interface Frame {
  id: number;
  from: string;
  type: string;
}

let counter = 0;

export default function SessionSimulator() {
  const [active, setActive] = useState(false);
  const [hostDoc, setHostDoc] = useState("const hello = 'world';");
  const [guestDoc, setGuestDoc] = useState("");
  const [frames, setFrames] = useState<Frame[]>([]);
  const [cursors, setCursors] = useState({ host: false, guest: false });

  const relay = (from: string, type: string) => {
    counter += 1;
    setFrames((prev) => [{ id: counter, from, type }, ...prev].slice(0, 6));
  };

  const startSession = () => {
    setActive(true);
    setGuestDoc(hostDoc);
    setFrames([]);
    relay("server", "connected");
    relay("host", "doc.state →");
  };

  const typeOnHost = () => {
    if (!active) return;
    setHostDoc((doc) => `${doc} +`);
    setGuestDoc((doc) => `${doc} +`);
    setCursors({ host: true, guest: false });
    relay("host", "presence.cursor →");
    relay("host", "doc.update →");
  };

  const typeOnGuest = () => {
    if (!active) return;
    setHostDoc((doc) => `${doc}-`);
    setGuestDoc((doc) => `${doc}-`);
    setCursors({ host: false, guest: true });
    relay("guest", "presence.cursor →");
    relay("guest", "doc.update →");
  };

  const stopSession = () => {
    setActive(false);
    setFrames([]);
    setCursors({ host: false, guest: false });
  };

  const paneStyle = (lit: boolean): React.CSSProperties => ({
    border: `1.5px solid ${lit ? "#7c3aed" : "rgba(124,58,237,0.25)"}`,
    boxShadow: lit ? "inset 0 0 12px rgba(124,58,237,0.35)" : "none",
  });

  return (
    <div
      style={{
        display: "grid",
        gap: "1rem",
        padding: "1.25rem",
        borderRadius: "1rem",
        background:
          "linear-gradient(135deg, rgba(124,58,237,0.08), rgba(244,244,245,0.4))",
        backdropFilter: "blur(16px)",
        border: "1.5px solid rgba(124,58,237,0.2)",
      }}
    >
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {!active ? (
          <button
            onClick={startSession}
            style={buttonStyle("#7c3aed")}
            type="button"
          >
            Start Session
          </button>
        ) : (
          <>
            <button onClick={typeOnHost} style={buttonStyle()} type="button">
              Type on Host
            </button>
            <button onClick={typeOnGuest} style={buttonStyle()} type="button">
              Type on Guest
            </button>
            <button
              onClick={stopSession}
              style={buttonStyle("#ef4444")}
              type="button"
            >
              Stop
            </button>
          </>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <pre style={{ ...paneStyle(cursors.host), ...paneBase }}>
          host{"\n"}{hostDoc || "…"}
        </pre>
        <pre style={{ ...paneStyle(cursors.guest), ...paneBase }}>
          guest{"\n"}{guestDoc || "…"}
        </pre>
      </div>

      <div>
        {frames.length === 0 ? (
          <p style={{ margin: 0, opacity: 0.6, fontSize: "0.85rem" }}>
            Relay log is empty — start a session to see frames flow.
          </p>
        ) : (
          frames.map((frame) => (
            <div key={frame.id} style={{ fontSize: "0.8rem", opacity: 0.85 }}>
              <code>
                [{frame.from}] {frame.type}
              </code>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const paneBase: React.CSSProperties = {
  margin: 0,
  padding: "0.75rem",
  borderRadius: "0.75rem",
  background: "rgba(255,255,255,0.06)",
  minHeight: "3.5rem",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  fontSize: "0.85rem",
};

function buttonStyle(color = "#7c3aed"): React.CSSProperties {
  return {
    background: color === "#ef4444" ? "rgba(239,68,68,0.15)" : "rgba(124,58,237,0.14)",
    border: `1px solid ${color}`,
    color: "inherit",
    padding: "0.4rem 0.9rem",
    borderRadius: "0.6rem",
    fontWeight: 600,
    cursor: "pointer",
  };
}
