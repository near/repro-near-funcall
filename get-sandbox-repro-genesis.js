const { Command } = require('commander')
const fetch = require('node-fetch')
const assert = require('assert').strict
const program = new Command()
const fs = require('fs').promises
const path = require('path')
const BN = require('bn.js')

program
  .option('-c, --contracts <contracts...>', 'contract accounts to fetch')
  .option('-a, --accounts <accounts...>', 'accounts and access keys to fetch')
  .option(
    '-b, --block-id <block>',
    'block height to dump, if not specified, will use latest block'
  )
  .option(
    '-u, --rpc-node-url <url>',
    'NEAR rpc node url',
    'https://rpc.testnet.near.org'
  )
  .option(
    '-s, --sandbox-home <dir>',
    'Sandbox Node Home Directory',
    '/tmp/near-sandbox'
  )

async function loadAndBackupSandboxGenesis({ sandboxHome }) {
  let genesis = await fs.readFile(path.join(sandboxHome, 'genesis.json'))
  await fs.writeFile(path.join(sandboxHome, 'genesis.json.bak'), genesis)
  return JSON.parse(genesis)
}

async function fetchContractState({ blockId, contractAccount, rpcNodeUrl }) {
  let params = blockId ? { block_id: Number(blockId) } : { finality: 'final' }
  const req = await fetch(rpcNodeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },

    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'query',
      params: {
        request_type: 'view_state',
        account_id: contractAccount,
        prefix_base64: '',
        ...params,
      },
    }),
  })
  const res = await req.json()
  let stateRecords = []
  for (let kv of res.result.values) {
    stateRecords.push({
      Data: { account_id: contractAccount, data_key: kv.key, value: kv.value },
    })
  }
  return stateRecords
}

async function fetchContractCode({ rpcNodeUrl, contractAccount, blockId }) {
  let params = blockId ? { block_id: Number(blockId) } : { finality: 'final' }
  const req = await fetch(rpcNodeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'query',
      params: {
        request_type: 'view_code',
        account_id: contractAccount,
        prefix_base64: '',
        ...params,
      },
    }),
  })
  const res = await req.json()
  return {
    Contract: { account_id: contractAccount, code: res.result.code_base64 },
  }
}

async function fetchBlock({ rpcNodeUrl, blockId }) {
  let params = blockId ? { block_id: Number(blockId) } : { finality: 'final' }
  const req = await fetch(rpcNodeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'block',
      params,
    }),
  })
  const res = await req.json()
  return res.result
}

async function fetchAccount({ blockId, rpcNodeUrl, account }) {
  let params = blockId ? { block_id: Number(blockId) } : { finality: 'final' }
  const req = await fetch(rpcNodeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'query',
      params: {
        request_type: 'view_account',
        account_id: account,
        ...params,
      },
    }),
  })
  const res = await req.json()
  return formatAccount(account, res.result)
}

function formatAccount(accountId, account) {
  return {
    Account: {
      account_id: accountId,
      account: {
        amount: account.amount,
        locked: account.locked,
        code_hash: account.code_hash,
        storage_usage: account.storage_usage,
      },
    },
  }
}

async function fetchAccessKey({ blockId, rpcNodeUrl, account }) {
  let params = blockId ? { block_id: Number(blockId) } : { finality: 'final' }
  const req = await fetch(rpcNodeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'query',
      params: {
        request_type: 'view_access_key_list',
        account_id: account,
        ...params,
      },
    }),
  })
  const res = await req.json()
  return res.result.keys.map((key) => formatAccessKey(account, key))
}

function formatAccessKey(account_id, key) {
  return {
    AccessKey: {
      account_id,
      ...key,
    },
  }
}

async function fetchProtocolConfig({ blockId, rpcNodeUrl }) {
  let params = blockId ? { block_id: Number(blockId) } : { finality: 'final' }
  const req = await fetch(rpcNodeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'EXPERIMENTAL_protocol_config',
      params,
    }),
  })
  const res = await req.json()
  return res.result
}

async function fetchGenesisConfig({ rpcNodeUrl }) {
  const req = await fetch(rpcNodeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'EXPERIMENTAL_genesis_config',
    }),
  })
  const res = await req.json()
  return res.result
}

function calculateOutputGenesisConfig({
  sandboxGenesis,
  protocolConfig,
  targetNetGenesis,
}) {
  // None of the genesis/protocol config from target net or the local sandbox's genesis config alone cannot
  // be used as sandbox's genesis config to reproduce transaction. So we calculate a synthetic genesis config
  // given these three.
  return {
    // Use protocol config as basis
    ...protocolConfig,
    // Network ID cannot be testnet or mainnet
    chain_id: 'sandbox-' + protocolConfig.chain_id,
    // This field is not available in protocol config yet
    protocol_upgrade_num_epochs: targetNetGenesis.protocol_upgrade_num_epochs,
    // Total supply is tricky, depends which accounts are added (specified by -a option), they should add up
    total_supply: sandboxGenesis.total_supply,
    // Use validator local sandbox's validator/key info so sandbox can continue produce blocks
    validators: sandboxGenesis.validators,
    records: sandboxGenesis.records,
  }
}

function addAccountToTotalSupply(genesis, account) {
  genesis.total_supply = new BN(genesis.total_supply)
    .add(new BN(account.Account.account.amount))
    .add(new BN(account.Account.account.locked))
    .toString()
}

async function main() {
  program.parse(process.argv)
  const options = program.opts()
  let sandboxGenesis = await loadAndBackupSandboxGenesis({
    sandboxHome: options.sandboxHome,
  })
  let protocolConfig = await fetchProtocolConfig({
    blockId: options.blockId,
    rpcNodeUrl: options.rpcNodeUrl,
  })
  let targetNetGenesis = await fetchGenesisConfig({
    rpcNodeUrl: options.rpcNodeUrl,
  })
  let outputGenesisConfig = calculateOutputGenesisConfig({
    sandboxGenesis,
    protocolConfig,
    targetNetGenesis,
  })
  let state_records = []
  if (options.contracts) {
    for (let contract of options.contracts) {
      let code = await fetchContractCode({
        contractAccount: contract,
        blockId: options.blockId,
        rpcNodeUrl: options.rpcNodeUrl,
      })
      let states = await fetchContractState({
        contractAccount: contract,
        blockId: options.blockId,
        rpcNodeUrl: options.rpcNodeUrl,
      })
      let account = await fetchAccount({
        account: contract,
        blockId: options.blockId,
        rpcNodeUrl: options.rpcNodeUrl,
      })
      let accessKeys = await fetchAccessKey({
        account: contract,
        blockId: options.blockId,
        rpcNodeUrl: options.rpcNodeUrl,
      })
      state_records.push(account)
      addAccountToTotalSupply(outputGenesisConfig, account)
      state_records = state_records.concat(accessKeys)
      state_records.push(code)
      state_records = state_records.concat(states)
    }
  }
  if (options.accounts) {
    for (let accountId of options.accounts) {
      if (
        !options.contracts ||
        (options.contracts && !options.contracts.includes(accountId))
      ) {
        let account = await fetchAccount({
          account: accountId,
          blockId: options.blockId,
          rpcNodeUrl: options.rpcNodeUrl,
        })
        let accessKeys = await fetchAccessKey({
          account: accountId,
          blockId: options.blockId,
          rpcNodeUrl: options.rpcNodeUrl,
        })
        state_records.push(account)
        addAccountToTotalSupply(outputGenesisConfig, account)
        state_records = state_records.concat(accessKeys)
      }
    }
  }
  outputGenesisConfig.records =
    outputGenesisConfig.records.concat(state_records)
  await fs.writeFile(
    path.join(options.sandboxHome, 'genesis.json'),
    JSON.stringify(outputGenesisConfig, null, 2)
  )
}

main()
