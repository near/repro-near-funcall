const { Command } = require("commander");
const fetch = require("node-fetch");
const assert = require("assert").strict;
const program = new Command();
const fs = require("fs").promises;

program
  .requiredOption("-a, --account <account>", "account id")
  .requiredOption("-t, --transaction <transaction>", "transaction hash")
  .option("-r --receipt-id <receipt-id>", "receipt id (hash)")
  .option(
    "-u, --rpc-node-url <url>",
    "NEAR rpc node url",
    "https://rpc.testnet.near.org"
  );

function txnStatusFullToVMContext({ txnStatusFull, receiptId }) {
  const { transaction, receipts } = txnStatusFull;
  let receipt = receiptId
    ? receipts.filter((r) => r.receipt_id == receiptId)
    : receipts.filter(
        (r) =>
          r.receiver_id == transaction.receiver_id &&
          r.predecessor_id == transaction.signer_id
      );

  assert(receipt.length == 1);
  receipt = receipt[0];
  let action = receipt.receipt.Action.actions;
  assert(action.length == 1);
  action = action[0];
  assert(action.FunctionCall);
  let signer_account_pk = transaction.public_key.split(":");
  assert(signer_account_pk[0] == "ed25519");
  signer_account_pk = signer_account_pk[1];
  return {
    current_account_id: receipt.receiver_id,
    signer_account_id: transaction.signer_id,
    signer_account_pk,
    predecessor_account_id: receipt.predecessor_id,
    input: action.FunctionCall.args,
    attached_deposit: action.FunctionCall.deposit,
    prepaid_gas: action.FunctionCall.gas,
    is_view: false,
    output_data_receivers: receipt.receipt.Action.output_data_receivers.map(
      (r) => r.receiver_id
    ),
  };
}

async function fetchBlock({ blockHash, rpcNodeUrl }) {
  const req = await fetch(rpcNodeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "block",
      params: {
        block_id: blockHash,
      },
    }),
  });
  const res = await req.json();
  return res.result;
}

async function fetchTxnStatusFull({ transaction, account, rpcNodeUrl }) {
  const req = await fetch(rpcNodeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "EXPERIMENTAL_tx_status",
      params: [transaction, account],
    }),
  });
  const res = await req.json();
  return res.result;
}

function blockToVMContext(block) {
  return {
    block_index: block.header.height,

    // TODO: once https://github.com/near/nearcore/pull/4221 merged, we'll have epoch_height from `validators` rpc
    // epoch_height: block.header.epoch_id,
    epoch_height: 1,
    block_timestamp: block.header.timestamp_nanosec,
    random_seed: block.header.random_value,
  };
}

async function fetchAccount({ blockHash, rpcNodeUrl, account }) {
  const req = await fetch(rpcNodeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: {
        request_type: "view_account",
        block_id: blockHash,
        account_id: account,
      },
    }),
  });
  const res = await req.json();
  return res.result;
}

function accountToVMContext(account) {
  return {
    account_balance: account.amount,
    account_locked_balance: account.locked,
    storage_usage: account.storage_usage,
  };
}

async function fetchContractState({ rpcNodeUrl, contractAccount, blockHash }) {
  const req = await fetch(rpcNodeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: {
        request_type: "view_state",
        block_id: blockHash,
        account_id: contractAccount,
        prefix_base64: "",
      },
    }),
  });
  const res = await req.json();
  console.log(res.result.values);
  let state = {};
  for (let kv of res.result.values) {
    state[kv.key] = kv.value;
  }
  return state;
}

async function fetchContractCode({ rpcNodeUrl, contractAccount, blockHash }) {
  const req = await fetch(rpcNodeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: {
        request_type: "view_code",
        block_id: blockHash,
        account_id: contractAccount,
        prefix_base64: "",
      },
    }),
  });
  const res = await req.json();
  return Buffer.from(res.result.code_base64, "base64");
}

async function main() {
  program.parse(process.argv);
  const options = program.opts();
  const txnStatusFull = await fetchTxnStatusFull(options);
  const vmContext1 = txnStatusFullToVMContext({
    txnStatusFull,
    receiptId: options.receiptId,
  });
  let blockHash;
  if (options.receiptId) {
    let receipt = txnStatusFull.receipts_outcome.filter(
      (r) => r.id == options.receiptId
    );
    blockHash = receipt[0].block_hash;
  } else {
    blockHash = txnStatusFull.transaction_outcome.block_hash;
  }
  const block = await fetchBlock({
    blockHash,
    rpcNodeUrl: options.rpcNodeUrl,
  });
  const vmContext2 = blockToVMContext(block);
  const account = await fetchAccount({
    blockHash: txnStatusFull.transaction_outcome.block_hash,
    rpcNodeUrl: options.rpcNodeUrl,
    account: options.account,
  });
  const vmContext3 = accountToVMContext(account);
  const vmContext = { ...vmContext1, ...vmContext2, ...vmContext3 };

  await fs.writeFile("./vmcontext.json", JSON.stringify(vmContext, null, 2));
  const code = await fetchContractCode({
    rpcNodeUrl: options.rpcNodeUrl,
    contractAccount: vmContext.current_account_id,
    blockHash: txnStatusFull.transaction_outcome.block_hash,
  });
  await fs.writeFile("./contract.wasm", code);

  const state = await fetchContractState({
    rpcNodeUrl: options.rpcNodeUrl,
    contractAccount: vmContext.current_account_id,
    blockHash: txnStatusFull.transaction_outcome.block_hash,
  });
  await fs.writeFile("./state.json", JSON.stringify(state, null, 2));
}

main();
