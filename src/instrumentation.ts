// Next.js server startup hook. Runs once when the server boots (nodejs runtime
// only). We ensure the demo site exists in the persistent store so existing
// demos / smoke checks keep working after the selfize migration. Failures are
// logged-then-swallowed so a transient selfize hiccup never blocks boot.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { seedDemoSite } = await import('@/lib/sites-instance')
    await seedDemoSite()
  } catch {
    // best-effort seed; the app still serves with whatever sites already exist.
  }
}
