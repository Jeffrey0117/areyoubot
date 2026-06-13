import { NextResponse } from 'next/server'
import { gateAdmin } from '@/lib/admin-auth'

// Tells the client whether the bearer token belongs to the admin. Used only for
// UX gating in the admin page — never leaks the configured admin email, and the
// real authorisation is still enforced on every /api/admin/sites call.
export async function GET(request: Request): Promise<NextResponse> {
  const gate = gateAdmin(request)
  return NextResponse.json({ isAdmin: gate.ok })
}
