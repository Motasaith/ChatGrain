import { Wrench } from "lucide-react";

/**
 * What a customer sees while maintenance mode is on.
 *
 * It says that their agents are still answering, before anything else it
 * could say. The question a customer has on landing here is "is my website's
 * chat broken", and the answer is no.
 */
export function MaintenancePage({ message }: { message: string }) {
  return (
    <main className="maintenance-page">
      <section>
        <span>
          <Wrench size={22} />
        </span>
        <h1>Back in a few minutes</h1>
        <p>{message}</p>
        <small>This page checks again when you reload it.</small>
      </section>
    </main>
  );
}
