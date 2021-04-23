const { Command } = require("commander");
const fetch = require("node-fetch");
const assert = require("assert").strict;
const program = new Command();
const fs = require("fs").promises;

program
  .requiredOption("-a, --accounts <accounts...>", "accounts to dump storage")
  .option("-b, --block-id <block>", "block height to dump")
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
  let result = {};
  let prefix = Buffer.concat([
    Buffer.from([9]),
    Buffer.from(contractAccount),
    Buffer.from(","),
  ]);
  for (let kv of res.result.values) {
    result[Buffer.concat([prefix, Buffer.from(kv.key)]).toString("base64")] =
      kv.value;
  }
  return result;
}

async function main() {
  program.parse(process.argv);
  const options = program.opts();
  //   console.log(options);
  let allState = {};
  for (let contractAccount of options.accounts) {
    let contractState = await fetchContractState({
      contractAccount,
      blockId: options.blockId,
      rpcNodeUrl: options.rpcNodeUrl,
    });
    Object.assign(allState, contractState);
  }
  console.log(JSON.stringify(allState, null, 2));
}

main();
