"use client";

import { FormEvent, useState } from "react";
import { ArrowUp, Bot, ExternalLink } from "lucide-react";

const answers = {
  refund: {
    question: "What happens if I am charged twice?",
    answer:
      "Duplicate charges are refunded in full to the original payment method within 3–5 business days.",
    source: "refund-policy.md · paragraph 7",
  },
  api: {
    question: "What are the API limits?",
    answer:
      "The Scale plan includes 100 requests per minute, with short bursts up to twice that limit.",
    source: "api-reference.md · rate limits",
  },
  security: {
    question: "Where is customer data stored?",
    answer:
      "In the self-hosted edition, sources and conversations stay in the PostgreSQL database you operate.",
    source: "deployment.md · data ownership",
  },
};

type AnswerKey = keyof typeof answers;

function matchAnswer(value: string): AnswerKey {
  if (/api|rate|limit/i.test(value)) return "api";
  if (/data|store|security|private/i.test(value)) return "security";
  return "refund";
}

export function AgentDemo() {
  const [question, setQuestion] = useState(answers.refund.question);
  const [draft, setDraft] = useState("");
  const [current, setCurrent] = useState<AnswerKey>("refund");
  const [typing, setTyping] = useState(false);

  function ask(kind: AnswerKey, customQuestion?: string) {
    setQuestion(customQuestion || answers[kind].question);
    setTyping(true);
    window.setTimeout(() => {
      setCurrent(kind);
      setTyping(false);
    }, 420);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    ask(matchAnswer(value), value);
    setDraft("");
  }

  return (
    <div className="home-agent">
      <div className="home-agent-head">
        <span className="home-agent-avatar"><Bot size={18} /></span>
        <span>
          <b>Sofia</b>
          <small><i /> Uses verified sources</small>
        </span>
        <em>Live demo</em>
      </div>
      <div className="home-agent-messages" aria-live="polite">
        <div className="home-agent-user">{question}</div>
        {typing ? (
          <div className="home-agent-answer home-agent-typing">
            <i /><i /><i />
          </div>
        ) : (
          <div className="home-agent-answer">
            <p>{answers[current].answer}</p>
            <a href="#workflow">
              <ExternalLink size={11} />
              {answers[current].source}
            </a>
          </div>
        )}
      </div>
      <div className="home-agent-chips">
        <button type="button" onClick={() => ask("refund")}>Refunds</button>
        <button type="button" onClick={() => ask("api")}>API limits</button>
        <button type="button" onClick={() => ask("security")}>Data</button>
      </div>
      <form className="home-agent-input" onSubmit={submit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about refunds, APIs, or data"
          aria-label="Ask the demo agent"
        />
        <button type="submit" aria-label="Send question">
          <ArrowUp size={15} />
        </button>
      </form>
    </div>
  );
}
