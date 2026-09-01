import packageJson from "../../package.json" with { type: "json" };

/**
 * The version this build reports.
 *
 * Read from the package rather than typed in. The literal used to say "0.2.0"
 * for two releases, which is worse than reporting nothing: a version string is
 * only ever consulted by somebody trying to work out which build they are
 * looking at, so a stale one actively misleads the one person who needs it.
 *
 * `.version` explicitly, and that is the point of this file. `/api/health` had
 * `process.env.npm_package_version ?? packageJson`, where the fallback is the
 * whole parsed package - every dependency and its range - returned from an
 * endpoint that needs no authentication. It never fired in practice because
 * PM2 starts the app through npm, which sets the variable. It would have fired
 * the first time anybody ran the server with plain `node`.
 *
 * Note that this is the *tagged* version. Open releases deliberately do not
 * bump it, so a server running 0.5.0 work reports 0.3.0 - which is why the
 * admin dashboard explains the difference rather than showing this alone.
 */
export const APP_VERSION: string =
  process.env.npm_package_version?.trim() || packageJson.version;
