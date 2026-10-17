import { describe, expect, it, vi } from 'vitest'
import { assertDbLessD4OwnerAutoOptIn } from './current-overlay-owner-opt-in'

const repo = 'badjoke-lab/xrpl-lending-monitor'
type Comment = { user: { login: string }; body: string }
const note = (who: string, body: string): Comment => ({ user: { login: who }, body })
function mockPages(pages: Comment[][], httpStatus=200): typeof fetch {
  return vi.fn(async (url: string) => {
    const requested = new URL(url)
    expect(requested.hostname).toBe('api.github.com')
    expect(requested.pathname).toBe('/repos/badjoke-lab/xrpl-lending-monitor/issues/1736/comments')
    const page = Number(requested.searchParams.get('page') ?? 0)
    return new Response(JSON.stringify(pages[page - 1] ?? []), { status: httpStatus })
  }) as unknown as typeof fetch
}
const check = (fetcher: typeof fetch) =>
  assertDbLessD4OwnerAutoOptIn({repository:repo,token:'test-only-token',fetcher})

describe('D4 immediate pre-CAS owner authorization check', () => {
  it('permits an exact owner enable when it is the latest control comment', async () => {
    await expect(check(mockPages([[
      note('attacker', '/d4-auto-disable'),
      note('badjoke-lab', '/d4-auto-enable'),
    ]]))).resolves.toBeUndefined()
  })
  it('blocks revocation made after the Actions pre-write check', async () => {
    await expect(check(mockPages([[
      note('badjoke-lab', '/d4-auto-enable'),
      note('badjoke-lab', '/d4-auto-disable'),
    ]]))).rejects.toThrow(/disabled or permission revoked/)
  })
  it('ignores commands by other accounts and rejects absence of owner opt-in', async () => {
    await expect(check(mockPages([[
      note('attacker', '/d4-auto-enable'),
    ]]))).rejects.toThrow(/disabled or permission revoked/)
  })
  it('reads every comments page and uses the last owner control comment', async () => {
    const filler = Array.from({length:100}, () => note('random-user', 'hello'))
    await expect(check(mockPages([
      [note('badjoke-lab','/d4-auto-disable'), ...filler.slice(1)],
      [note('badjoke-lab','/d4-auto-enable')],
    ]))).resolves.toBeUndefined()
    await expect(check(mockPages([
      [note('badjoke-lab','/d4-auto-enable'), ...filler.slice(1)],
      [note('badjoke-lab','/d4-auto-disable')],
    ]))).rejects.toThrow(/disabled or permission revoked/)
  })
  it('fails closed on API error, malformed response, and unbounded history', async () => {
    await expect(check(mockPages([[]],503))).rejects.toThrow(/verification unavailable/)
    const bad = vi.fn(async () => new Response('{}',{status:200})) as unknown as typeof fetch
    await expect(check(bad)).rejects.toThrow(/malformed/)
    const full=Array.from({length:100},()=>note('random-user','x'))
    const fetcher=mockPages(Array.from({length:50},(_,i)=>i===0
      ? [note('badjoke-lab','/d4-auto-enable'),...full.slice(1)]
      : full))
    await expect(check(fetcher)).rejects.toThrow(/pagination bound exceeded/)
  })
  it('refuses invalid repo or absent token before making requests', async () => {
    await expect(assertDbLessD4OwnerAutoOptIn({
      repository:'bad/example/escape',token:'x',fetcher:mockPages([]),
    })).rejects.toThrow(/exact repository/)
    await expect(assertDbLessD4OwnerAutoOptIn({
      repository:repo,token:'',fetcher:mockPages([]),
    })).rejects.toThrow(/exact repository/)
  })
})
