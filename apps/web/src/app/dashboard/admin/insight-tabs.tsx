import Link from "next/link";
import { sql } from "drizzle-orm";
import { Gauge, Inbox, ThumbsDown, Timer, Target } from "lucide-react";
import { AdminAutoRefresh } from "@/components/app/admin-auto-refresh";
import { SANDBOX_CHANNEL } from "@/lib/chat/sandbox";
import { db } from "@/lib/db/client";

import {
  type AdminSearchParams,
  PAGE_SIZE,
  adminHref,
  readPage,
  readParam,
} from "./shared";
import { QUALITY_MIN_ANSWERS, groundedRate, qualityRows, waitingConversationRows, waitingTicketRows } from "./queries";
import { AdminPanel, Empty, ExportLink, FilterChips, Pager, SearchForm, StatTile, Toolbar, When } from "./ui";

const formatMs = (value: number | null) =>
  value === null ? "-" : value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`;

const formatRate = (rate: number | null) => (rate === null ? "-" : `${Math.round(rate * 100)}%`);

export async function QualityTab({ params }: { params: AdminSearchParams }) {
  const { days, sort, total, rows } = await qualityRows(params);
  const filters = { window: days === 30 ? "" : String(days), sort };
  const overall = total ? groundedRate(total) : null;

  return (
    <>
      <div className="admin-stats-grid admin-stats-4">
        <StatTile
          hint={`Across every workspace, last ${days} days`}
          icon={Gauge}
          label="Answers"
          value={total?.answers ?? 0}
        />
        <StatTile
          hint={total ? `${total.ungrounded.toLocaleString()} answers without evidence` : "No answers yet"}
          icon={Target}
          label="Grounded"
          tone={overall !== null && overall < 0.6 ? "bad" : overall !== null && overall < 0.8 ? "warn" : undefined}
          value={formatRate(overall)}
        />
        <StatTile
          hint={`Average ${formatMs(total?.avgLatencyMs ?? null)}`}
          icon={Timer}
          label="Slowest 5% take"
          value={formatMs(total?.p95LatencyMs ?? null)}
        />
        <StatTile
          hint={`${(total?.thumbsUp ?? 0).toLocaleString()} thumbs up`}
          icon={ThumbsDown}
          label="Thumbs down"
          tone={(total?.thumbsDown ?? 0) > (total?.thumbsUp ?? 0) ? "warn" : undefined}
          value={total?.thumbsDown ?? 0}
        />
      </div>

      <AdminPanel
        action={<ExportLink filters={filters} tab="quality" />}
        description={`Grounded means the answer was built from the workspace's own content. A rate needs ${QUALITY_MIN_ANSWERS} judged answers before it is ranked or coloured.`}
        title="Answer quality by workspace"
      >
        <Toolbar>
          <FilterChips
            current={filters.window}
            filters={filters}
            name="window"
            options={[
              { value: "7", label: "7 days" },
              { value: "", label: "30 days" },
              { value: "90", label: "90 days" },
            ]}
            tab="quality"
          />
          <FilterChips
            current={sort}
            filters={filters}
            name="sort"
            options={[
              { value: "", label: "Busiest" },
              { value: "grounded", label: "Least grounded" },
              { value: "slow", label: "Slowest" },
              { value: "feedback", label: "Most thumbs down" },
            ]}
            tab="quality"
          />
        </Toolbar>
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Answers</th>
                <th>Grounded</th>
                <th>Average</th>
                <th title="95th percentile: the time within which 95% of answers arrived">p95</th>
                <th>Thumbs up</th>
                <th>Thumbs down</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rate = groundedRate(row);
                return (
                  <tr key={row.workspaceId}>
                    <td>
                      <Link href={adminHref("workspace", { id: row.workspaceId ?? "" })}>{row.workspaceName}</Link>
                    </td>
                    <td>{row.answers.toLocaleString()}</td>
                    <td>
                      <span
                        className={`admin-rate${rate === null ? "" : rate < 0.6 ? " bad" : rate < 0.8 ? " warn" : " good"}`}
                        title={`${row.grounded} grounded, ${row.ungrounded} not`}
                      >
                        {formatRate(rate)}
                      </span>
                    </td>
                    <td>{formatMs(row.avgLatencyMs)}</td>
                    <td>{formatMs(row.p95LatencyMs)}</td>
                    <td>{row.thumbsUp.toLocaleString()}</td>
                    <td className={row.thumbsDown > row.thumbsUp ? "admin-bad-text" : undefined}>
                      {row.thumbsDown.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length ? null : <Empty>No agent answered anybody in the last {days} days.</Empty>}
      </AdminPanel>
    </>
  );
}

export async function WaitingTab({ params }: { params: AdminSearchParams }) {
  const kind = readParam(params, "kind") === "tickets" ? "tickets" : "";
  const query = readParam(params, "q");
  const page = readPage(params);
  const filters = { q: query, kind };

  const [conversationRows, ticketRows, [counts]] = await Promise.all([
    kind ? Promise.resolve([]) : waitingConversationRows(params, PAGE_SIZE + 1, page * PAGE_SIZE),
    kind ? waitingTicketRows(params, PAGE_SIZE + 1, page * PAGE_SIZE) : Promise.resolve([]),
    db.execute<{ conversations: number; tickets: number }>(sql`
      select
        (select count(*)::int from conversations
          where status = 'escalated' and channel <> ${SANDBOX_CHANNEL}) as conversations,
        (select count(*)::int from tickets where status in ('open', 'pending')) as tickets
    `),
  ]);
  const rows = kind ? ticketRows : conversationRows;
  const shownConversations = conversationRows.slice(0, PAGE_SIZE);
  const shownTickets = ticketRows.slice(0, PAGE_SIZE);

  return (
    <AdminPanel
      action={
        <span className="admin-panel-actions">
          <AdminAutoRefresh seconds={30} />
          <ExportLink filters={filters} tab="waiting" />
        </span>
      }
      description="Visitors waiting on a person, in every workspace. Each workspace answers its own; this is for noticing when one is not."
      icon={Inbox}
      title="Waiting on a person"
    >
      <Toolbar>
        <SearchForm filters={{ kind }} placeholder="Workspace, subject or visitor" query={query} tab="waiting" />
        <FilterChips
          current={kind}
          filters={filters}
          name="kind"
          options={[
            { value: "", label: "Handed-off chats", count: counts.conversations },
            { value: "tickets", label: "Open tickets", count: counts.tickets },
          ]}
          tab="waiting"
        />
      </Toolbar>
      <div className="admin-table-scroll">
        {kind ? (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Workspace</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Last reply</th>
                <th>Opened</th>
              </tr>
            </thead>
            <tbody>
              {shownTickets.map((ticket) => (
                <tr key={ticket.id}>
                  <td className="admin-job-cell">
                    <b>{ticket.subject}</b>
                    <small><code>{ticket.reference}</code> · {ticket.requesterEmail ?? "No e-mail"}</small>
                  </td>
                  <td>
                    <Link href={adminHref("workspace", { id: ticket.workspaceId })}>{ticket.workspaceName}</Link>
                  </td>
                  <td>
                    <i className={`status-pill ${ticket.priority === "urgent" || ticket.priority === "high" ? "status-error" : ""}`}>
                      {ticket.priority}
                    </i>
                  </td>
                  <td><i className="status-pill status-review">{ticket.status}</i></td>
                  <td className="admin-muted">{ticket.lastReplyBy ?? "Nobody yet"}</td>
                  <td><When value={ticket.createdAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Conversation</th>
                <th>Workspace</th>
                <th>Agent</th>
                <th>Last message</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {shownConversations.map((conversation) => (
                <tr key={conversation.id}>
                  <td className="admin-job-cell">
                    <b>{conversation.title ?? "Untitled conversation"}</b>
                    <small>
                      {conversation.visitorName ?? "Anonymous visitor"}
                      {conversation.visitorEmail ? ` · ${conversation.visitorEmail}` : ""}
                    </small>
                  </td>
                  <td>
                    <Link href={adminHref("workspace", { id: conversation.workspaceId })}>{conversation.workspaceName}</Link>
                  </td>
                  <td>{conversation.agentName}</td>
                  <td><When value={conversation.lastMessageAt} /></td>
                  <td><When value={conversation.createdAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {rows.length ? null : (
        <Empty>
          {query ? "Nothing matches." : kind ? "No open tickets anywhere." : "Nobody is waiting on a person."}
        </Empty>
      )}
      <Pager
        filters={filters}
        hasMore={rows.length > PAGE_SIZE}
        page={page}
        shown={kind ? shownTickets.length : shownConversations.length}
        tab="waiting"
      />
    </AdminPanel>
  );
}

