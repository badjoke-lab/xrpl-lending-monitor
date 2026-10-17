/**
 * Last-moment production Current CAS owner opt-in check.
 * Only used by explicitly enabled unattended D4 publisher.
 * A prior check in the Actions workflow is insufficient: immutable shard
 * uploads can take a long time, during which the owner may revoke permission.
 * No writes; fail closed for all API/identity/pagination uncertainties.
 */
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const COMMANDS = new Set(['/d4-auto-enable', '/d4-auto-disable'])
const ISSUE = 1736
const PER_PAGE = 100
const MAX_PAGES = 50

type GitHubIssueComment = {
  user?: { login?: unknown }
  body?: unknown
}

export async function assertDbLessD4OwnerAutoOptIn(options: {
  repository: string
  token: string
  fetcher?: typeof fetch
}): Promise<void> {
  const { repository, token } = options
  if (!REPOSITORY.test(repository) || typeof token !== 'string' || !token) {
    throw new Error('D4 auto opt-in read requires exact repository and GitHub token')
  }
  const owner = repository.split('/')[0]!
  const fetcher = options.fetcher ?? fetch
  let lastCommand: string | null = null
  let exhausted = false
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `https://api.github.com/repos/${repository}/issues/${ISSUE}/comments?per_page=${PER_PAGE}&page=${page}`
    const response = await fetcher(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    })
    if (!response.ok) {
      throw new Error('D4 auto opt-in GitHub comments verification unavailable')
    }
    const comments: unknown = await response.json()
    if (!Array.isArray(comments) || comments.length > PER_PAGE) {
      throw new Error('D4 auto opt-in GitHub comments response is malformed')
    }
    for (const comment of comments as GitHubIssueComment[]) {
      if (comment?.user?.login !== owner || typeof comment.body !== 'string') continue
      if (COMMANDS.has(comment.body)) lastCommand = comment.body
    }
    if (comments.length < PER_PAGE) {
      exhausted = true
      break
    }
  }
  if (!exhausted) throw new Error('D4 auto opt-in comments pagination bound exceeded')
  if (lastCommand !== '/d4-auto-enable') {
    throw new Error('D4 unattended Current publication disabled or permission revoked')
  }
}
