/**
 * Stands in for the `server-only` package inside the voice gateway process.
 *
 * `server-only` resolves to an empty module only under the `react-server`
 * export condition, which a bundler supplies and plain Node does not - there it
 * resolves to a module that throws on import. The gateway legitimately needs
 * server modules that carry the marker (widget token verification, for one), so
 * `tsconfig.voice.json` maps the specifier here instead.
 *
 * The marker still protects the Next.js build, which never uses that mapping.
 */
export {};
