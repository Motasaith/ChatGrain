# Docent web application

This workspace contains the Next.js dashboard, route handlers, embeddable
widget, crawler worker, and Drizzle schema.

Run commands from the repository root so the web process and worker share the
same environment:

```powershell
Copy-Item ../../.env.example .env.local
npm run db:push
npm run dev
```

See the root [README](../../README.md) for architecture, configuration,
production guidance, and all available commands.
