// React and Ink pick their development builds unless NODE_ENV says otherwise; those cost memory
// and render time on every caption update. Only the published bundle defaults to production:
// running from source (pnpm dev) keeps development warnings.
// This only works because React and Ink load later, from the dynamically imported TUI chunk: a
// static import of either in index.tsx would be hoisted above this line by the bundler.
if (!import.meta.url.endsWith(".ts")) process.env.NODE_ENV ??= "production";
