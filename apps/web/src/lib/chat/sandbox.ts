/**
 * The marker that separates an administrator's scratch conversation from a real
 * one.
 *
 * `conversations.channel` already existed and already meant "where did this come
 * from" - widget, and whatever else arrives later. A sandbox conversation is
 * genuinely a different channel by that definition, so this reuses the column
 * rather than adding a boolean beside it that would have to be kept in step.
 *
 * Everything that shows a customer their own conversations filters this out,
 * and ending the session deletes them. Both halves are needed: the filter is
 * what makes the promise true while the session is open, and the delete is what
 * makes it true afterwards.
 */
export const SANDBOX_CHANNEL = "admin_sandbox";
