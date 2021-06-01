const { Command } = require("commander");
const fetch = require("node-fetch");
const assert = require("assert").strict;
const program = new Command();
const fs = require("fs").promises;

program
  .option("-c, --contracts <contracts...>", "contract accounts to fetch")
  .option("-a, --accounts <accounts...>", "accounts and access keys to fetch")
  .option(
    "-b, --block-id <block>",
    "block height to dump, if not specified, will use latest block"
  )
  .option(
    "-u, --rpc-node-url <url>",
    "NEAR rpc node url",
    "https://rpc.testnet.near.org"
  );

async function fetchContractState({ blockId, contractAccount, rpcNodeUrl }) {
  let params = blockId ? { block_id: Number(blockId) } : { finality: "final" };
  const req = await fetch(rpcNodeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },

    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: {
        request_type: "view_state",
        account_id: contractAccount,
        prefix_base64: "",
        ...params,
      },
    }),
  });
  const res = await req.json();
  let stateRecords = [];
  for (let kv of res.result.values) {
    stateRecords.push({
      Data: { account_id: contractAccount, data_key: kv.key, value: kv.value },
    });
  }
  return stateRecords;
}

async function fetchContractCode({ rpcNodeUrl, contractAccount, blockId }) {
  let params = blockId ? { block_id: Number(blockId) } : { finality: "final" };
  const req = await fetch(rpcNodeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: {
        request_type: "view_code",
        account_id: contractAccount,
        prefix_base64: "",
        ...params,
      },
    }),
  });
  const res = await req.json();
  return Buffer.from(res.result.code_base64, "base64");
}

async function fetchBlock({ rpcNodeUrl, blockId }) {
  let params = blockId ? { block_id: Number(blockId) } : { finality: "final" };
  const req = await fetch(rpcNodeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "block",
      params,
    }),
  });
  const res = await req.json();
  return res.result;
}

async function fetchAccount({ blockId, rpcNodeUrl, account }) {
  let params = blockId ? { block_id: Number(blockId) } : { finality: "final" };
  const req = await fetch(rpcNodeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: {
        request_type: "view_account",
        account_id: account,
        ...params,
      },
    }),
  });
  const res = await req.json();
  console.log(res.result);
  return res.result;
}

async function fetchAccessKey({ blockId, rpcNodeUrl, account }) {
  let params = blockId ? { block_id: Number(blockId) } : { finality: "final" };
  const req = await fetch(rpcNodeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: {
        request_type: "view_access_key_list",
        account_id: account,
        ...params,
      },
    }),
  });
  const res = await req.json();
  return res.result;
}

async function fetchProtocolConfig({ blockId, rpcNodeUrl }) {
  let params = blockId ? { block_id: Number(blockId) } : { finality: "final" };
  const req = await fetch(rpcNodeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "EXPERIMENTAL_protocol_config",
      params,
    }),
  });
  const res = await req.json();
  return res.result;
}

async function main() {
  program.parse(process.argv);
  const options = program.opts();
  let genesis = await fetchProtocolConfig({
    blockId: options.blockId,
    rpcNodeUrl: options.rpcNodeUrl,
  });
  let state_records = [];
  if (options.contracts) {
    for (let contract of options.contracts) {
      let code = await fetchContractCode({
        contractAccount: contract,
        blockId: options.blockId,
        rpcNodeUrl: options.rpcNodeUrl,
      });
      let states = await fetchContractState({
        contractAccount: contract,
        blockId: options.blockId,
        rpcNodeUrl: options.rpcNodeUrl,
      });
      let account = await fetchAccount({
        account: contract,
        blockId: options.blockId,
        rpcNodeUrl: options.rpcNodeUrl,
      });
      let accessKeys = await fetchAccessKey({
        account: contract,
        blockId: options.blockId,
        rpcNodeUrl: options.rpcNodeUrl,
      });
      state_records.push(account);
      state_records = state_records.concat(accessKeys);
      state_records.push(code);
      state_records = state_records.concat(states);
    }
  }
  if (options.accounts) {
    for (let account of options.accounts) {
      if (
        !options.contracts ||
        (options.contracts && !options.contracts.includes(account))
      ) {
        let account = await fetchAccount({
          account,
          blockId: options.blockId,
          rpcNodeUrl: options.rpcNodeUrl,
        });
        let accessKeys = await fetchAccessKey({
          account,
          blockId: options.blockId,
          rpcNodeUrl: options.rpcNodeUrl,
        });
        state_records.push(account);
        state_records = state_records.concat(accessKeys);
      }
    }
  }
  genesis.state_records = state_records;
  console.log(genesis);
}

main();
