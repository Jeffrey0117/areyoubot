// Shared ES256 test key + token signer for the route tests.
//
// letmeuse signs access tokens with ES256 and publishes the public half at
// /api/jwks. Tests must not reach the network, so route tests mock
// '@/lib/jwks-cache' to serve the public key from here:
//
//   vi.mock('@/lib/jwks-cache', async () => {
//     const h = await import('../helpers/test-jwks')
//     return {
//       getJwksPublicKey: (kid: string) => (kid === h.TEST_KID ? h.testPublicKey : null),
//       getJwksStats: () => ({ url: 'test', keys: 1, lastSuccessAt: null, lastError: null }),
//     }
//   })

import crypto from 'node:crypto'

export const TEST_KID = 'test-kid'
export const TEST_APP_ID = 'app_test_areyoubot'

const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
export const testPrivateKey = pair.privateKey
export const testPublicKey = pair.publicKey

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

/**
 * Sign an ES256 token the way letmeuse (jose) does: signature is raw r||s
 * ("ieee-p1363"), not DER.
 */
export function signEs256(
  payload: Record<string, unknown>,
  opts: { key?: crypto.KeyObject; header?: Record<string, unknown> } = {}
): string {
  const header = { alg: 'ES256', typ: 'JWT', kid: TEST_KID, ...(opts.header ?? {}) }
  const signingInput = `${b64(header)}.${b64(payload)}`
  const sig = crypto.sign('sha256', Buffer.from(signingInput), {
    key: opts.key ?? testPrivateKey,
    dsaEncoding: 'ieee-p1363',
  })
  return `${signingInput}.${sig.toString('base64url')}`
}

/** A valid access token for this app, expiring in an hour. */
export function makeUserToken(payload: Record<string, unknown>): string {
  return signEs256({
    app: TEST_APP_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payload,
  })
}
