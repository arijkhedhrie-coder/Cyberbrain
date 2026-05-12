import { useState, useRef, useEffect } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

interface ChatMessage {
  sender: "user" | "bot";
  text: string;
}

export const ChatBot = () => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const send = async () => {
    if (!input.trim()) return;
    const userMsg = input.trim();
    setMessages(prev => [...prev, { sender: "user", text: userMsg }]);
    setInput("");
    setThinking(true);
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { sender: "bot", text: data.response || "Désolé, je n'ai pas compris." }]);
    } catch {
      setMessages(prev => [...prev, { sender: "bot", text: "Impossible de contacter l'assistant." }]);
    } finally {
      setThinking(false);
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 56, height: 56, borderRadius: "50%",
          background: "linear-gradient(135deg, #1D9E75, #0bd18c)",
          border: "none", color: "white", fontSize: 24,
          cursor: "pointer", boxShadow: "0 4px 15px rgba(0,0,0,0.3)", zIndex: 2000,
        }}
      >
        💬
      </button>

      {/* Chat window */}
      {open && (
        <div style={{
          position: "fixed",
          bottom: 90, right: 24, width: 360, height: 480,
          background: "#0f1623", borderRadius: 12,
          border: "1px solid #1e293b", display: "flex", flexDirection: "column",
          zIndex: 2000, boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
        }}>
          <div style={{
            padding: "12px 16px", borderBottom: "1px solid #1e293b",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ color: "#e2e8f0", fontWeight: 700 }}>🤖 Assistant IDPS</span>
            <button onClick={() => setOpen(false)} style={{
              background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 18,
            }}>✕</button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: 8 }}>
            {messages.length === 0 && (
              <div style={{ color: "#475569", fontSize: 12, textAlign: "center", marginTop: 40 }}>
                Posez une question sur le système IDPS…
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} style={{
                alignSelf: msg.sender === "user" ? "flex-end" : "flex-start",
                background: msg.sender === "user" ? "#1D9E75" : "#1e293b",
                color: msg.sender === "user" ? "white" : "#c9d1e0",
                padding: "8px 12px", borderRadius: 10, maxWidth: "80%",
                fontSize: 12, lineHeight: 1.4,
              }}>
                {msg.text}
              </div>
            ))}
            {thinking && (
              <div style={{ color: "#64748b", fontSize: 11, alignSelf: "flex-start" }}>
                🤔 L'assistant réfléchit…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div style={{ padding: "10px", borderTop: "1px solid #1e293b", display: "flex", gap: 6 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send()}
              placeholder="Demandez quelque chose…"
              style={{
                flex: 1, padding: "8px 10px", borderRadius: 6, border: "1px solid #334155",
                background: "#1e293b", color: "#e2e8f0", fontSize: 12, fontFamily: "inherit",
                outline: "none",
              }}
            />
            <button onClick={send} disabled={!input.trim()} style={{
              padding: "8px 12px", borderRadius: 6, background: "#1D9E75", border: "none", color: "white",
              fontWeight: 700, cursor: "pointer", fontSize: 12,
            }}>→</button>
          </div>
        </div>
      )}
    </>
  );
};