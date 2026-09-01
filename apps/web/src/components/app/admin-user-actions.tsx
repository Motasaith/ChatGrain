"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  LoaderCircle,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserCog,
} from "lucide-react";
import { useAskDialog } from "@/components/app/ask-dialog";

/**
 * Per-user administrative actions.
 *
 * Deletion is irreversible and removes the user's workspaces along with every
 * agent and conversation in them, so it asks for typed confirmation rather than
 * a single click.
 */
export function AdminUserActions({
  userId,
  email,
  retentionExempt,
  platformRole,
  canChangeRoles,
  fixedByEnvironment,
}: {
  userId: string;
  email: string;
  retentionExempt: boolean;
  platformRole: string;
  /** Only a super administrator sees the role control at all. */
  canChangeRoles: boolean;
  /** Listed in ADMIN_EMAILS, so their role is set by configuration. */
  fixedByEnvironment: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const { ask, dialog } = useAskDialog();

  async function toggleExempt() {
    setBusy("exempt");
    setError("");
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ retentionExempt: !retentionExempt }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error?.message || "Could not update the user.");
        return;
      }
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  /**
   * Promoting and demoting, which used to mean an SSH session.
   *
   * Three named steps rather than a free-text field, because the set is closed
   * and typing "Admin" into a box that wants "admin" is a way to be told
   * nothing happened.
   *
   * Granting is deliberately blunt about what it means. An administrator can
   * see and act inside every customer account on the installation, and somebody
   * clicking this on a colleague should be told that in those words rather than
   * discovering it later.
   */
  async function setRole(next: "member" | "admin" | "superadmin") {
    const wording = {
      member: (
        <>
          <b>{email}</b> will lose access to the admin dashboard and every
          customer account on this installation.
        </>
      ),
      admin: (
        <>
          <b>{email}</b> will be able to see and act inside{" "}
          <b>every customer account</b> on this installation — impersonate them,
          edit their agents, stop their crawls. They will not be able to change
          anyone&apos;s role.
        </>
      ),
      superadmin: (
        <>
          <b>{email}</b> will get everything an administrator can do,{" "}
          <b>plus the ability to grant that to anybody else</b>. Give this only
          to someone you would give the server to.
        </>
      ),
    }[next];

    const ok = await ask({
      title: `Make ${email} a ${next === "member" ? "regular user" : next}?`,
      body: wording,
      confirmLabel: next === "member" ? "Remove access" : `Make ${next}`,
      danger: next !== "member" || platformRole !== "member",
    });
    if (ok === null) return;

    setBusy("role");
    setError("");
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platformRole: next }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error?.message || "Could not change the role.");
        return;
      }
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    // The confirm button will not enable until the address matches, so a
    // resolved value here is already the right one.
    const typed = await ask({
      title: `Delete ${email}?`,
      body: (
        <>
          This also deletes any workspace they are the last member of, including
          its agents, sources and conversations.
        </>
      ),
      confirmLabel: "Delete permanently",
      danger: true,
      input: {
        label: "Type the email address to confirm",
        placeholder: email,
        mustMatch: email,
      },
    });
    if (typed === null) return;
    setBusy("delete");
    setError("");
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 204) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error?.message || "Could not delete the user.");
        return;
      }
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  return (
    <span className="admin-user-actions">
      {dialog}
      {error ? <em title={error}>!</em> : null}
      {/*
        A plain select rather than a menu. The set is three closed values, the
        control has to say which one is current, and anything more elaborate
        would be dressing up a dropdown.

        Shown only to a super administrator, and disabled for anyone whose role
        comes from ADMIN_EMAILS — the route refuses that anyway, but offering a
        control that always fails is worse than not offering it.
      */}
      {canChangeRoles ? (
        <label
          className={`admin-role-picker role-${platformRole}`}
          title={
            fixedByEnvironment
              ? `${email} is listed in ADMIN_EMAILS, so their role is set by configuration`
              : `Change what ${email} can do on this installation`
          }
        >
          <UserCog size={13} />
          <select
            aria-label={`Role for ${email}`}
            disabled={Boolean(busy) || fixedByEnvironment}
            onChange={(event) =>
              void setRole(
                event.target.value as "member" | "admin" | "superadmin",
              )
            }
            value={platformRole}
          >
            <option value="member">User</option>
            <option value="admin">Admin</option>
            <option value="superadmin">Super admin</option>
          </select>
        </label>
      ) : platformRole !== "member" ? (
        <i className="admin-role-badge">{platformRole}</i>
      ) : null}
      <button
        aria-label={
          retentionExempt
            ? `Allow inactivity cleanup for ${email}`
            : `Protect ${email} from inactivity cleanup`
        }
        disabled={Boolean(busy)}
        onClick={() => void toggleExempt()}
        title={
          retentionExempt
            ? "Protected from inactivity cleanup"
            : "Subject to inactivity cleanup"
        }
        type="button"
      >
        {busy === "exempt" ? (
          <LoaderCircle className="spin" size={14} />
        ) : retentionExempt ? (
          <ShieldCheck size={14} />
        ) : (
          <ShieldOff size={14} />
        )}
      </button>
      <button
        aria-label={`Delete ${email}`}
        title={`Permanently delete ${email} and any workspace they are the last member of`}
        className="is-danger"
        disabled={Boolean(busy)}
        onClick={() => void remove()}
        type="button"
      >
        {busy === "delete" ? (
          <LoaderCircle className="spin" size={14} />
        ) : (
          <Trash2 size={14} />
        )}
      </button>
    </span>
  );
}
