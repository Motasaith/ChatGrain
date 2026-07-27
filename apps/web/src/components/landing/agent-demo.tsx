"use client";

import { useState } from "react";
import { ArrowUp, Bot, ExternalLink } from "lucide-react";

const answers: Record<string, string> = {
  refund:
    "Yes. Duplicate charges are refunded in full to the original payment method within 3–5 business days.",
  api: "The Scale plan includes 100 API requests per minute, with short bursts up to twice that limit.",
};

export function AgentDemo() {
  const [question, setQuestion] = useState(
    "What happens if I’m charged twice?",
  );
  const [answer, setAnswer] = useState(answers.refund);
  const [typing, setTyping] = useState(false);

  function ask(kind: "refund" | "api") {
    setQuestion(
      kind === "refund"
        ? "What happens if I’m charged twice?"
        : "What are the API limits?",
    );
    setTyping(true);
    window.setTimeout(() => {
      setAnswer(answers[kind]);
      setTyping(false);
    }, 420);
  }

  return (
    <div className="agent-window">
      <div className="agent-window-head">
        <span className="agent-avatar">
          <Bot size={19} />
        </span>
        <span>
          <b>Sofia</b>
          <small>
            <i /> Answers from verified sources
          </small>
        </span>
        <em>LIVE</em>
      </div>
      <div className="agent-messages">
        <div className="agent-message user-message">{question}</div>
        {typing ? (
          <div className="agent-message bot-message typing-message">
            <i />
            <i />
            <i />
          </div>
        ) : (
          <div className="agent-message bot-message">
            {answer}
            <a href="#workflow">
              <ExternalLink size={11} />
              refund-policy.md · §7
            </a>
          </div>
        )}
      </div>
      <div className="agent-suggestions">
        <button onClick={() => ask("refund")}>Refunds</button>
        <button onClick={() => ask("api")}>API limits</button>
      </div>
      <div className="agent-input">
        <span>Ask a question…</span>
        <button aria-label="Send demo question">
          <ArrowUp size={16} />
        </button>
      </div>
      <div className="agent-powered">POWERED BY DOCENT</div>
    </div>
  );
}
