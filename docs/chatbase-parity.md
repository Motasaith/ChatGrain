# Chatbase parity roadmap

This comparison uses Chatbase's public documentation as the product baseline.
It is a planning document, not a claim that Docent should copy Chatbase's
implementation or branding.

## Where Docent is now

Docent already covers the core self-hosted website-support workflow:

- website and sitemap discovery, including JavaScript rendering fallback;
- file, CSV, text, and pinned question/answer sources;
- local embeddings in PostgreSQL with pgvector;
- grounded retrieval, confidence fallback, citations, and chat context;
- a customizable embeddable widget with feedback and contact handoff;
- conversations, leads, analytics, actions, domain controls, rate limits,
  administration, audit logs, and Sentry integration;
- scheduled source refreshes and a first-party support agent for Docent's own
  public website.

This is a credible self-hosted RAG support product, but not yet the full
customer-service platform described in Chatbase's documentation.

## Feature gap

### Core product parity

Highest-value work for the next release:

1. Add a source explorer with page-level include, exclude, preview, edit, and
   delete controls, plus clearer retrain history and failure recovery.
2. Add answer evaluation and revision tools so owners can inspect retrieval,
   correct a reply, pin the correction, and regression-test important
   questions.
3. Turn actions into a production tool runtime with authentication, typed
   inputs, response mapping, test execution, access control, and safe UI/client
   action support.
4. Complete widget UX: suggested questions, copy/delete messages, localization
   and RTL, light/dark themes, attachment handling, transcript continuity, and
   more granular branding controls.
5. Expand analytics with topics, sentiment, unresolved questions, conversion
   funnels, per-page performance, and export.
6. Add usage quotas, notifications, lead webhooks, backups, health alerts, and
   production operations controls.

Estimated effort: **4–8 weeks** for one strong full-stack developer, depending
on the desired polish and test depth.

### Helpdesk and channel parity

Chatbase also documents a broader service platform:

- a live operator inbox with takeover, assignment, routing, schedules, teams,
  filters, saved views, translations, and AI-drafted replies;
- escalation into helpdesks and CRMs;
- WhatsApp, Instagram, Messenger, email, Slack, and other channels;
- imports from Notion, remote storage, and support-ticket systems;
- provider/model selection, billing, workspace roles, and usage management.

Estimated effort: **2–4 additional months** for a small product team. Each
external channel has its own authentication, webhook, policy, retry, and
delivery-state work.

### Full platform breadth and maturity

Later parity includes voice and phone support, outbound campaigns, a hosted
help page, commerce and scheduling integrations, rich custom UI actions,
enterprise identity/security, and compliance work.

Estimated effort: **3–6 additional months**, with compliance and reliability
continuing after feature completion.

## Practical estimate

These percentages are engineering estimates, not measured vendor metrics:

- Docent is roughly **35–45% of Chatbase's documented feature breadth**.
- It is roughly **60–70% of the core website-trained support-agent workflow**.
- One developer should plan on **6–12 months** for broad parity.
- A focused team of two or three can target **3–6 months** for strong practical
  parity, then continue with integrations, scale, and enterprise requirements.

The recommended goal is practical parity for website support first, not a
feature-count race. Retrieval reliability, owner correction workflows,
operator handoff, and widget quality will create more user value than adding
every channel at once.

## Research sources

- [Chatbase data sources](https://www.chatbase.co/docs/user-guides/chatbot/data-sources)
- [Chatbase actions overview](https://www.chatbase.co/docs/user-guides/chatbot/actions/actions-overview)
- [Chatbase custom actions](https://www.chatbase.co/docs/user-guides/chatbot/actions/custom-action)
- [Chatbase channels and widget](https://www.chatbase.co/docs/user-guides/chatbot/channels)
- [Chatbase settings](https://www.chatbase.co/docs/user-guides/chatbot/settings)
- [Chatbase analytics](https://www.chatbase.co/docs/user-guides/chatbot/analytics)
- [Chatbase WhatsApp integration](https://www.chatbase.co/docs/user-guides/integrations/whatsapp)
- [Chatbase Twilio phone integration](https://www.chatbase.co/docs/user-guides/integrations/twilio)
