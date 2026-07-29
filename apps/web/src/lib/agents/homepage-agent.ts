import { and, eq, sql } from "drizzle-orm";
import { defaultAgentSystemPrompt } from "@/lib/agents/default-prompt";
import { db } from "@/lib/db/client";
import {
  agents,
  crawlJobs,
  sources,
  systemState,
  workspaces,
} from "@/lib/db/schema";
import { defaultLlmModel } from "@/lib/llm/client";

const homepageAgentStateKey = "homepage_agent";
const homepageWorkspaceSlug = "docent-system";
const managedSourceName = "Docent website";

type HomepageAgentState = {
  agentId?: string;
  sourceId?: string;
  siteUrl?: string;
};

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.round(parsed)))
    : fallback;
}

function configuredSiteUrl() {
  const value =
    process.env.DOCENT_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.NODE_ENV !== "production"
      ? "http://localhost:3000"
      : "");
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    url.search = "";
    return url;
  } catch {
    return null;
  }
}

function trustedDevelopmentUrl(url: URL) {
  return (
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  );
}

function homepagePrompt(siteUrl: string) {
  return `${defaultAgentSystemPrompt({
    agentName: "Docent Support",
    websiteUrl: siteUrl,
  })}

### Docent support
- Explain Docent's documented capabilities, setup, deployment, security, and limitations accurately.
- Never claim a planned feature is already available.
- Prefer links to the relevant Docent page or section when the source provides one.`;
}

function stateValue(value: Record<string, unknown> | null) {
  return (value ?? {}) as HomepageAgentState;
}

async function storedState() {
  const [state] = await db
    .select({ value: systemState.value })
    .from(systemState)
    .where(eq(systemState.key, homepageAgentStateKey))
    .limit(1);
  return stateValue(state?.value ?? null);
}

export async function getHomepageAgentId({
  usableOnly = false,
}: { usableOnly?: boolean } = {}) {
  const configuredId = process.env.DOCENT_SITE_AGENT_ID?.trim();
  if (configuredId) return configuredId;
  const state = await storedState();
  if (!state.agentId) return null;
  if (!usableOnly) return state.agentId;
  const [record] = await db
    .select({
      status: agents.status,
      lastSyncedAt: sources.lastSyncedAt,
    })
    .from(agents)
    .leftJoin(
      sources,
      and(
        eq(sources.agentId, agents.id),
        eq(sources.id, state.sourceId ?? ""),
      ),
    )
    .where(eq(agents.id, state.agentId))
    .limit(1);
  if (
    !record ||
    record.status === "paused" ||
    (record.status !== "ready" && !record.lastSyncedAt)
  ) {
    return null;
  }
  return state.agentId;
}

export async function ensureHomepageAgent() {
  const configuredId = process.env.DOCENT_SITE_AGENT_ID?.trim();
  if (configuredId) return configuredId;
  const siteUrl = configuredSiteUrl();
  if (!siteUrl) return null;

  const pageLimit = boundedInteger(
    process.env.DOCENT_SITE_PAGE_LIMIT,
    250,
    1,
    10_000,
  );
  const refreshHours = boundedInteger(
    process.env.DOCENT_SITE_REFRESH_HOURS,
    1,
    1,
    8_760,
  );
  const trustedInternal = trustedDevelopmentUrl(siteUrl);
  const domainAllowlist = [siteUrl.hostname];
  if (siteUrl.hostname === "localhost") domainAllowlist.push("127.0.0.1");

  await db
    .insert(workspaces)
    .values({
      name: "Docent System",
      slug: homepageWorkspaceSlug,
      plan: "system",
      settings: { internal: true },
    })
    .onConflictDoNothing({ target: workspaces.slug });
  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.slug, homepageWorkspaceSlug))
    .limit(1);
  if (!workspace) throw new Error("Could not create the Docent system workspace.");

  const previousState = await storedState();
  let [agent] = previousState.agentId
    ? await db
        .select()
        .from(agents)
        .where(eq(agents.id, previousState.agentId))
        .limit(1)
    : [];
  if (!agent) {
    [agent] = await db
      .insert(agents)
      .values({
        workspaceId: workspace.id,
        name: "Docent Support",
        description:
          "First-party support agent trained on the public Docent website.",
        status: "training",
        systemPrompt: homepagePrompt(siteUrl.origin),
        welcomeMessage:
          "Hi! Ask me about Docent features, setup, deployment, or how grounded agents work.",
        fallbackMessage:
          "I couldn’t find that in the current Docent website content.",
        primaryColor: "#177e51",
        collectFeedback: true,
        showCitations: true,
        strictMode: true,
        allowedDomains: domainAllowlist,
        modelProvider: "ollama",
        modelName: defaultLlmModel(),
        temperature: 0.1,
      })
      .returning();
  } else {
    [agent] = await db
      .update(agents)
      .set({
        name: "Docent Support",
        description:
          "First-party support agent trained on the public Docent website.",
        systemPrompt: homepagePrompt(siteUrl.origin),
        welcomeMessage:
          "Hi! Ask me about Docent features, setup, deployment, or how grounded agents work.",
        fallbackMessage:
          "I couldn’t find that in the current Docent website content.",
        primaryColor: "#177e51",
        allowedDomains: domainAllowlist,
        collectFeedback: true,
        showCitations: true,
        strictMode: true,
        modelProvider: "ollama",
        modelName: defaultLlmModel(),
        temperature: 0.1,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agent.id))
      .returning();
  }

  const managedSources = await db
    .select()
    .from(sources)
    .where(eq(sources.agentId, agent.id));
  let source =
    managedSources.find(
      (item) => item.metadata?.managedBy === "docent-homepage",
    ) ??
    (previousState.sourceId
      ? managedSources.find((item) => item.id === previousState.sourceId)
      : undefined);
  const sourceValues = {
    type: "website" as const,
    name: managedSourceName,
    rootUrl: siteUrl.href,
    includePaths: [],
    excludePaths: [
      "/api",
      "/dashboard",
      "/sign-in",
      "/sign-up",
      "/widget",
    ],
    pageLimit,
    refreshIntervalHours: refreshHours,
    nextSyncAt: new Date(),
    metadata: {
      managedBy: "docent-homepage",
      trustedInternal,
    },
    updatedAt: new Date(),
  };
  if (!source) {
    [source] = await db
      .insert(sources)
      .values({
        agentId: agent.id,
        ...sourceValues,
        status: "pending",
      })
      .returning();
  } else {
    const siteChanged = source.rootUrl !== siteUrl.href;
    [source] = await db
      .update(sources)
      .set({
        ...sourceValues,
        ...(siteChanged
          ? {
              status: "pending" as const,
              errorCode: null,
              errorMessage: null,
            }
          : {}),
      })
      .where(eq(sources.id, source.id))
      .returning();
  }

  const [activeJob] = await db
    .select({ id: crawlJobs.id })
    .from(crawlJobs)
    .where(
      and(
        eq(crawlJobs.sourceId, source.id),
        sql`${crawlJobs.status} in ('queued', 'running')`,
      ),
    )
    .limit(1);
  if (!activeJob) {
    await db.insert(crawlJobs).values({
      sourceId: source.id,
      priority: 100,
    });
  }

  await db
    .insert(systemState)
    .values({
      key: homepageAgentStateKey,
      value: {
        agentId: agent.id,
        sourceId: source.id,
        siteUrl: siteUrl.href,
      },
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: systemState.key,
      set: {
        value: {
          agentId: agent.id,
          sourceId: source.id,
          siteUrl: siteUrl.href,
        },
        updatedAt: new Date(),
      },
    });
  return agent.id;
}
