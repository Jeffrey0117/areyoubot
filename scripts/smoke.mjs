// areyoubot 端到端煙霧測試：要題 → 解 PoW → verify → 確認 replay 被擋
import { createHash } from 'node:crypto'

const base = process.env.AYB_BASE ?? 'http://localhost:4012'

const lzb = (b) => {
  let c = 0
  for (const x of b) {
    if (x === 0) { c += 8; continue }
    let m = 0x80
    while (m && !(x & m)) { c++; m >>= 1 }
    break
  }
  return c
}
const sha = (s) => createHash('sha256').update(s).digest()

const { token, difficulty } = await (await fetch(`${base}/api/challenge?sitekey=ayb_demo`)).json()
let n = 0
while (lzb(sha(`${token}:${n}`)) < difficulty) n++
const submitted = `${token}.${n}`

const post = (body) =>
  fetch(`${base}/api/verify`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json())

const v1 = await post({ token: submitted, secret: 'aybsk_demo' })
const v2 = await post({ token: submitted, secret: 'aybsk_demo' })

console.log('difficulty:', difficulty, 'solution nonce:', n)
console.log('first:', v1)
console.log('replay:', v2)

if (v1.success === true && v2.success === false) {
  console.log('SMOKE OK')
  process.exit(0)
} else {
  console.error('SMOKE FAILED')
  process.exit(1)
}
