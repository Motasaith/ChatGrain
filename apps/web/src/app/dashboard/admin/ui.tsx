import Form from "next/form";
import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { adminHref, formatRelative } from "./shared";

type Filters = Record<string, string | number | undefined>;

export function AdminPanel({
  title,
  description,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="app-card admin-panel">
      <div className="app-card-head">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action ?? (Icon ? <Icon size={18} /> : null)}
      </div>
      <div className="admin-panel-body">{children}</div>
    </section>
  );
}

/**
 * A number with the context that makes it mean something.
 *
 * A bare "412 users" says nothing about whether today is normal; the hint
 * underneath carries the recent change, and the tone flags the few numbers
 * that are only interesting when they are not zero.
 */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: LucideIcon;
  tone?: "warn" | "bad";
  href?: string;
}) {
  const body = (
    <>
      <span className="admin-stat-icon">
        <Icon size={16} />
      </span>
      <small>{label}</small>
      <strong>{typeof value === "number" ? value.toLocaleString() : value}</strong>
      {hint ? <em>{hint}</em> : null}
    </>
  );
  const className = `admin-stat${tone ? ` admin-stat-${tone}` : ""}`;
  return href ? (
    <Link className={className} href={href}>
      {body}
    </Link>
  ) : (
    <article className={className}>{body}</article>
  );
}

/**
 * One-of-several filter, as links. Each option carries its count so the chip
 * answers "how many" before it is pressed.
 */
export function FilterChips({
  tab,
  name,
  current,
  options,
  filters = {},
}: {
  tab: string;
  name: string;
  current: string;
  options: Array<{ value: string; label: string; count?: number }>;
  filters?: Filters;
}) {
  return (
    <nav className="admin-chips" aria-label={`Filter by ${name}`}>
      {options.map((option) => (
        <Link
          aria-current={current === option.value ? "true" : undefined}
          href={adminHref(tab, { ...filters, [name]: option.value, page: undefined })}
          key={option.value || "all"}
        >
          {option.label}
          {option.count !== undefined ? <b>{option.count.toLocaleString()}</b> : null}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Search box that submits as a GET, so the result is a URL like any other
 * filter. The other active filters ride along as hidden fields.
 */
export function SearchForm({
  tab,
  query,
  placeholder,
  filters = {},
}: {
  tab: string;
  query: string;
  placeholder: string;
  filters?: Filters;
}) {
  return (
    <Form action="/dashboard/admin" className="admin-search">
      <input name="tab" type="hidden" value={tab} />
      {Object.entries(filters).map(([key, value]) =>
        value === undefined || value === "" ? null : (
          <input key={key} name={key} type="hidden" value={String(value)} />
        ),
      )}
      <Search size={15} />
      <input
        aria-label={placeholder}
        defaultValue={query}
        name="q"
        placeholder={placeholder}
        type="search"
      />
      {query ? (
        <Link aria-label="Clear search" href={adminHref(tab, filters)}>
          <X size={14} />
        </Link>
      ) : null}
    </Form>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="admin-toolbar">{children}</div>;
}

export function Pager({
  tab,
  page,
  hasMore,
  shown,
  filters = {},
}: {
  tab: string;
  page: number;
  hasMore: boolean;
  shown: number;
  filters?: Filters;
}) {
  if (!page && !hasMore) return null;
  return (
    <div className="admin-pager">
      <span>
        Page {page + 1} · {shown.toLocaleString()} shown
      </span>
      {page > 0 ? (
        <Link href={adminHref(tab, { ...filters, page: page - 1 })}>
          <ChevronLeft size={14} /> Previous
        </Link>
      ) : (
        <span aria-disabled="true">
          <ChevronLeft size={14} /> Previous
        </span>
      )}
      {hasMore ? (
        <Link href={adminHref(tab, { ...filters, page: page + 1 })}>
          Next <ChevronRight size={14} />
        </Link>
      ) : (
        <span aria-disabled="true">
          Next <ChevronRight size={14} />
        </span>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="admin-empty">{children}</p>;
}

export function When({ value }: { value: Date | string }) {
  const date = new Date(value);
  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString("en")}>
      {formatRelative(date)}
    </time>
  );
}
