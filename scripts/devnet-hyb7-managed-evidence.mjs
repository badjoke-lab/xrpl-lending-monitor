import fs from 'node:fs/promises'
import * as xrpl from 'xrpl'

const DEVNET_WS = process.env.XRPL_DEVNET_WS ?? 'wss://s.devnet.rippletest.net:51233'
const OUTPUT_PATH = process.env.HYB7_EVIDENCE_OUTPUT ?? 'hyb7-managed-evidence.json'
const RIPPLE_EPOCH_UNIX_SECONDS = 946_684_800

function rippleTimeNow() {
  return Math.floor(Date.now() / 1000) - RIPPLE_EPOCH_UNIX_SECONDS
}

function transactionResult(response) {
  return response?.result?.meta?.TransactionResult ?? response?.result?.metaData?.TransactionResult ?? null
}

function transactionLedgerIndex(response) {
  return response?.result?.ledger_index ?? response?.result?.ledgerIndex ?? null
}

function affectedNodes(response) {
  return response?.result?.meta?.AffectedNodes ?? response?.result?.metaData?.AffectedNodes ?? []
}

function createdObjectId(response, ledgerEntryType) {
  for (const node of affectedNodes(response)) {
    if (node?.CreatedNode?.LedgerEntryType === ledgerEntryType) {
      return node.CreatedNode.LedgerIndex
    }
  }
  throw new Error(`Created ${ledgerEntryType} object was not found in transaction metadata`)
}

async function submitSigned(client, wallet, transaction, label) {
  const prepared = await client.autofill(transaction)
  const signed = wallet.sign(prepared)
  const response = await client.submitAndWait(signed.tx_blob)
  const result = transactionResult(response)
  if (result !== 'tesSUCCESS') {
    throw new Error(`${label} failed with ${result ?? 'unknown result'}`)
  }
  return {
    label,
    hash: signed.hash,
    ledgerIndex: transactionLedgerIndex(response),
    result,
    response,
  }
}

async function submitLoanSet(client, broker, borrower, transaction) {
  const prepared = await client.autofill(transaction)
  const brokerSigned = broker.sign(prepared)
  const counterpartySigned = xrpl.signLoanSetByCounterparty(borrower, brokerSigned.tx_blob)
  const response = await client.submitAndWait(counterpartySigned.tx_blob)
  const result = transactionResult(response)
  if (result !== 'tesSUCCESS') {
    throw new Error(`LoanSet failed with ${result ?? 'unknown result'}`)
  }
  return {
    label: 'LoanSet',
    hash: counterpartySigned.hash,
    ledgerIndex: transactionLedgerIndex(response),
    result,
    response,
  }
}

async function fundParty(client, role) {
  const funded = await client.fundWallet()
  return { role, wallet: funded.wallet, address: funded.wallet.address }
}

async function waitUntilDefaultEligible(client, loanId) {
  const entry = await client.request({ command: 'ledger_entry', index: loanId })
  const loan = entry?.result?.node
  if (!loan) throw new Error('Loan ledger entry is unavailable before default wait')

  const nextPaymentDueDate = Number(loan.NextPaymentDueDate)
  const gracePeriod = Number(loan.GracePeriod ?? 0)
  if (!Number.isFinite(nextPaymentDueDate) || !Number.isFinite(gracePeriod)) {
    throw new Error('Loan default timing fields are invalid')
  }

  const eligibleAt = nextPaymentDueDate + gracePeriod
  const waitSeconds = Math.max(0, eligibleAt - rippleTimeNow() + 5)
  if (waitSeconds > 240) {
    throw new Error(`Default eligibility wait ${waitSeconds}s exceeds the 240s safety limit`)
  }
  if (waitSeconds > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000))
  }
  return { nextPaymentDueDate, gracePeriod, eligibleAt, waitSeconds }
}

async function main() {
  const client = new xrpl.Client(DEVNET_WS)
  const transactions = []
  const objects = {}
  const parties = {}

  await client.connect()
  try {
    const [issuer, lender, borrower, broker] = await Promise.all([
      fundParty(client, 'issuer'),
      fundParty(client, 'lender'),
      fundParty(client, 'borrower'),
      fundParty(client, 'broker'),
    ])

    for (const party of [issuer, lender, borrower, broker]) {
      parties[party.role] = party.address
    }

    transactions.push(await submitSigned(client, issuer.wallet, {
      TransactionType: 'AccountSet',
      Account: issuer.address,
      SetFlag: xrpl.AccountSetAsfFlags.asfDefaultRipple,
    }, 'AccountSet issuer DefaultRipple'))

    for (const party of [lender, borrower, broker]) {
      transactions.push(await submitSigned(client, party.wallet, {
        TransactionType: 'TrustSet',
        Account: party.address,
        LimitAmount: { currency: 'USD', issuer: issuer.address, value: '100000' },
      }, `TrustSet ${party.role}`))
    }

    transactions.push(await submitSigned(client, issuer.wallet, {
      TransactionType: 'Payment',
      Account: issuer.address,
      Destination: lender.address,
      Amount: { currency: 'USD', issuer: issuer.address, value: '10000' },
    }, 'Payment issuer to lender'))

    transactions.push(await submitSigned(client, issuer.wallet, {
      TransactionType: 'Payment',
      Account: issuer.address,
      Destination: broker.address,
      Amount: { currency: 'USD', issuer: issuer.address, value: '1000' },
    }, 'Payment issuer to broker'))

    const vaultCreate = await submitSigned(client, broker.wallet, {
      TransactionType: 'VaultCreate',
      Account: broker.address,
      Asset: { currency: 'USD', issuer: issuer.address },
      AssetsMaximum: '100000',
    }, 'VaultCreate')
    transactions.push(vaultCreate)
    objects.vaultId = createdObjectId(vaultCreate.response, 'Vault')

    const loanBrokerSet = await submitSigned(client, broker.wallet, {
      TransactionType: 'LoanBrokerSet',
      Account: broker.address,
      VaultID: objects.vaultId,
    }, 'LoanBrokerSet')
    transactions.push(loanBrokerSet)
    objects.loanBrokerId = createdObjectId(loanBrokerSet.response, 'LoanBroker')

    transactions.push(await submitSigned(client, lender.wallet, {
      TransactionType: 'VaultDeposit',
      Account: lender.address,
      VaultID: objects.vaultId,
      Amount: { currency: 'USD', issuer: issuer.address, value: '5000' },
    }, 'VaultDeposit'))

    transactions.push(await submitSigned(client, broker.wallet, {
      TransactionType: 'LoanBrokerCoverDeposit',
      Account: broker.address,
      LoanBrokerID: objects.loanBrokerId,
      Amount: { currency: 'USD', issuer: issuer.address, value: '500' },
    }, 'LoanBrokerCoverDeposit'))

    const loanSet = await submitLoanSet(client, broker.wallet, borrower.wallet, {
      TransactionType: 'LoanSet',
      Account: broker.address,
      LoanBrokerID: objects.loanBrokerId,
      PrincipalRequested: '1000',
      Counterparty: borrower.address,
      InterestRate: 500,
      PaymentInterval: 10,
      PaymentTotal: 12,
    })
    transactions.push(loanSet)
    objects.loanId = createdObjectId(loanSet.response, 'Loan')

    transactions.push(await submitSigned(client, broker.wallet, {
      TransactionType: 'LoanManage',
      Account: broker.address,
      LoanID: objects.loanId,
      Flags: 131072,
    }, 'LoanManage impair'))

    transactions.push(await submitSigned(client, broker.wallet, {
      TransactionType: 'LoanManage',
      Account: broker.address,
      LoanID: objects.loanId,
      Flags: 262144,
    }, 'LoanManage unimpair'))

    transactions.push(await submitSigned(client, broker.wallet, {
      TransactionType: 'LoanManage',
      Account: broker.address,
      LoanID: objects.loanId,
      Flags: 131072,
    }, 'LoanManage impair before default'))

    const defaultTiming = await waitUntilDefaultEligible(client, objects.loanId)

    transactions.push(await submitSigned(client, broker.wallet, {
      TransactionType: 'LoanManage',
      Account: broker.address,
      LoanID: objects.loanId,
      Flags: 65536,
    }, 'LoanManage default'))

    const evidence = {
      generatedAt: new Date().toISOString(),
      network: 'devnet',
      endpoint: DEVNET_WS,
      parties,
      objects,
      defaultTiming,
      transactions: transactions.map(({ label, hash, ledgerIndex, result }) => ({
        label,
        hash,
        ledgerIndex,
        result,
      })),
    }

    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(evidence, null, 2)}\n`)
    console.log(JSON.stringify(evidence, null, 2))
  } finally {
    await client.disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
