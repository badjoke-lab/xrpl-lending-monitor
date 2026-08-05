const triggerPath = '/functions/v1/xrpl-r5-recovery-batch-trigger'
const exactError = 'r5_checkpoint_drain_collector_not_quiescent'

export function isRetryableR5CollectorContention(status, body) {
  if (status !== 500 || typeof body !== 'object' || body === null || Array.isArray(body)) {
    return false
  }
  const executor = body.executor
  return body.schemaVersion === 1
    && body.purpose === 'r5-first-active-recovery-batch'
    && body.operationMode === 'execute_batch'
    && typeof executor === 'object'
    && executor !== null
    && !Array.isArray(executor)
    && executor.activeMutationCommitted === false
    && executor.batchId === null
    && executor.transient === false
    && typeof executor.error === 'string'
    && executor.error.includes(exactError)
}

export async function rewriteR5CollectorContentionResponse(url, response) {
  if (
    typeof url !== 'string'
    || !url.endsWith(triggerPath)
    || response.status !== 500
  ) {
    return response
  }

  let body
  try {
    body = JSON.parse(await response.clone().text())
  } catch {
    return response
  }
  if (!isRetryableR5CollectorContention(response.status, body)) return response

  return new Response(
    JSON.stringify({
      ...body,
      executor: {
        ...body.executor,
        transient: true,
      },
      retryClassification: 'collector_contention_without_mutation',
    }),
    {
      status: response.status,
      statusText: response.statusText,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  )
}
