# Tool to get enough information for reproduce NEAR contract execution locally

## Usage

```
npm i
node index.js -a <txn sender> -t <txn hash>
```

It will download `state.json`, `vmcontext.json` and `contract.wasm`, which can be pass to near-vm-runner-standalone

## Examples

Let's trying with examples of contract in different senarios, where you can reproduce contract execution from simplest state, multiple state where per user data is stored as seperate entry on trie, and cross contract read/write. These examples are intentionally created to simulate real world contract reproduce workflow.

### Preparation

- Have `near-cli` installed locally
- Have `near-vm-runner-standalone` compiled after merge this two branches into master: `fix-vmcontext-ser`, `state-file-standalone`.
- Register an account on https://wallet.testnet.near.org
- Login with `near login`
- Set environment var of your near account: `export REPRO_ACCOUNT=<your-account.testnet>`

### Repro execution of a simple contract

1. Deploy contract on testnet:

```
near create-account simple-state.$REPRO_ACCOUNT --initialBalance 10 --masterAccount $REPRO_ACCOUNT
near deploy --accountId simple-state.$REPRO_ACCOUNT --wasmFile res/simple_state.wasm
```

2. Call a contract method:

```
near call simple-state.$REPRO_ACCOUNT set_status --accountId $REPRO_ACCOUNT '{"message":"hello"}'
```

It will print a explorer link, such as: https://explorer.testnet.near.org/transactions/8No2dz4GKNRAFJcdU34wYngr6HRBQkNV5ZLMn1z1TfVc. Remember the transaction hash: `export TXN=8No2dz4GKNRAFJcdU34wYngr6HRBQkNV5ZLMn1z1TfVc`

3. Download code, state and vmcontext used to execute the function call action (contract method call):

```
node index.js -a $REPRO_ACCOUNT -t $TXN
```

4. Now we're able to reproduce this transaction locally, by:

```
near-vm-runner-standalone --context-file vmcontext.json --method-name set_status --wasm-file contract.wasm --state-file state.json --profile-gas --timings
```

Result:

```
      74.47µs get_key
        10.86ms run_method/instantiate
        5.52ms run_method/call
        6.54ms run_method/drop_instance
      23.03ms run_method
    1.11s run_wasmer
  1.11s run_vm

{"outcome":{"balance":"189978309984683730567830612","storage_usage":346,"return_data":"None","burnt_gas":291040465116,"used_gas":291040465116,"logs":["repro.testnet set_status with message hello"]},"err":null,"receipts":[],"state":{"U1RBVEU=":"AQAAAA0AAAByZXByby50ZXN0bmV0BQAAAGhlbGxv"}}
------------------------------
Total gas: 291040465116
Host gas: 215297482305 [73% total]
Action gas: 0 [0% total]
Wasm execution: 75742982811 [26% total]
------ Host functions --------
base -> 2912449221 [1% total, 1% host]
contract_compile_base -> 35445963 [0% total, 0% host]
contract_compile_bytes -> 30761160000 [10% total, 14% host]
read_memory_base -> 10439452800 [3% total, 4% host]
read_memory_byte -> 315510639 [0% total, 0% host]
write_memory_base -> 8411384583 [2% total, 3% host]
write_memory_byte -> 168873864 [0% total, 0% host]
read_register_base -> 7551495558 [2% total, 3% host]
read_register_byte -> 6110844 [0% total, 0% host]
write_register_base -> 11462089944 [3% total, 5% host]
write_register_byte -> 349743888 [0% total, 0% host]
utf8_decoding_base -> 3111779061 [1% total, 1% host]
utf8_decoding_byte -> 12537960597 [4% total, 5% host]
log_base -> 3543313050 [1% total, 1% host]
log_byte -> 567548013 [0% total, 0% host]
storage_write_base -> 64196736000 [22% total, 29% host]
storage_write_key_byte -> 352414335 [0% total, 0% host]
storage_write_value_byte -> 930556170 [0% total, 0% host]
storage_write_evicted_byte -> 963519210 [0% total, 0% host]
storage_read_base -> 56356845750 [19% total, 26% host]
storage_read_key_byte -> 154762665 [0% total, 0% host]
storage_read_value_byte -> 168330150 [0% total, 0% host]
------ Actions --------
------------------------------
```

### Repro execution of a contract with per account state as seperate entries on trie

Steps are same as simple-contract, only difference is you'll get more entries in state.json:

```
# Deploy contract
near create-account multiple-state.$REPRO_ACCOUNT --initialBalance 10 --masterAccount $REPRO_ACCOUNT
near deploy --accountId multiple-state.$REPRO_ACCOUNT --wasmFile res/multiple_state.wasm --initFunction new --initArgs '{}'
# Call a contract method
near call multiple-state.$REPRO_ACCOUNT set --accountId $REPRO_ACCOUNT '{"title":"hello","message":"world"}'
# Let's call with different to see multiple state in actions
near call multiple-state.$REPRO_ACCOUNT set --accountId multiple-state.$REPRO_ACCOUNT '{"title":"hello2","message":"world2"}'
Scheduling a call: multiple-state.repro.testnet.set({"title":"hello2","message":"world2"})
# Here record the txn hash manually, choose the txn hash of the second call above:
# export TXN=
# Download code, state and vmcontext
node index.js -a $REPRO_ACCOUNT -t $TXN
# cat state.json will show multiple entries
# Repro
near-vm-runner-standalone --context-file vmcontext.json --method-name set --wasm-file contract.wasm --state-file state.json --profile-gas --timings
```

### Repro execution of a function call that has cross contract write

Initial steps are same

```
# Deploy contract
near create-account cross-contract.$REPRO_ACCOUNT --initialBalance 10 --masterAccount $REPRO_ACCOUNT
near deploy --accountId cross-contract.$REPRO_ACCOUNT --wasmFile res/cross_contract.wasm --initFunction new --initArgs "{\"state_contract\":\"simple-state.$REPRO_ACCOUNT\"}"
# Call a contract method
near call cross-contract.$REPRO_ACCOUNT set_in_other_contract --accountId $REPRO_ACCOUNT '{"message":"world"}'
```

Now if you see this transaction on explorer you'll see these receipts:

```
$REPRO_ACCOUNT calls cross-contract.$REPRO_ACCOUNT
  cross-contract.$REPRO_ACCOUNT calls simple-state.$REPRO_ACCOUNT
    system calls $REPRO_ACCOUNT
  system calls $REPRO_ACCOUNT
```

Ignore system calls receipts, the second one is you'll see the one than previous non-cross contract call receipts. If you click on the block you'll also see it happens one block later than the first receipt (The most likely case, if network is on high load then more is possible). So to reproduce it locally you'll need to do it in two step, since they're having different block height, different state, different vm context and different contract code.

#### `$REPRO_ACCOUNT` calls `cross-contract.$REPRO_ACCOUNT`

This step is easy, just download and reproduce as before:

```
# export TXN=
node index.js -a $REPRO_ACCOUNT -t $TXN
near-vm-runner-standalone --context-file vmcontext.json --method-name set_in_other_contract --wasm-file contract.wasm --state-file state.json --profile-gas --timings
```

The major difference of the output is it has a (Promise) ReceiptIndex return and a receipt saying it's going to do a function call in another contract:

```
"return_data":{"ReceiptIndex":0},...,
"receipts":[{"receipt_indices":[],"receiver_id":"simple-state.repro.testnet","actions":[{"FunctionCall":{"method_name":"set_status","args":"{\"message\":\"world\"}","gas":50000000000000,"deposit":0}}]}],"state":{"U1RBVEU=":"AAAAABoAAABzaW1wbGUtc3RhdGUucmVwcm8udGVzdG5ldA=="}
```

#### `cross-contract.$REPRO_ACCOUNT` calls `simple-state.$REPRO_ACCOUNT`

This step download a different vm context, state and code. First look up the receipt id of this function call action from explorer, then download with:

```
node index.js -a $REPRO_ACCOUNT -t $TXN -r GrkKW2WJRKgkLfnAVVjktRba3RoLa6UVMSUhyJ6Dpwpf # replace with receipt id found in explorer
```

And reproduce with

```
near-vm-runner-standalone --context-file vmcontext.json --method-name set_status --wasm-file contract.wasm --state-file state.json --profile-gas --timings
```

### Repro execution of a function call that has cross contract read or promise result as input

Use the contract deployed in previous section, then call:

```
near call cross-contract.$REPRO_ACCOUNT get_from_other_contract_and_record --accountId $REPRO_ACCOUNT "{\"account_id\":\"$REPRO_ACCOUNT\"}"
```

There are three steps in this transaction:

1. `$REPRO_ACCOUNT` calls `cross-contract.$REPRO_ACCOUNT`, `get_from_other_contract_and_record` method, which create two receipts (step 2 and 3) that does the actual cross contract call.
2. `cross-contract.$REPRO_ACCOUNT` calls `simple-state.$REPRO_ACCOUNT`, `get_status` method. This is a cross contract read, returned result is used as parameter as step 3.
3. `cross-contract.$REPRO_ACCOUNT` calls it's `get_from_other_callback` method, takes argument from step 2's return.

Reproduce the first step (a cross contract read) of the transaction is same as before:

```
export TXN=
node index.js -a $REPRO_ACCOUNT -t $TXN
near-vm-runner-standalone --context-file vmcontext.json --method-name get_from_other_contract_and_record --wasm-file contract.wasm --state-file state.json --profile-gas --timings
```

Reproduce the second step is also similar to the previous section's second part, lookup the receipt id from explorer (Find the receipt include `get_status` function call) then run:

```
node index.js -a $REPRO_ACCOUNT -t $TXN -r <Your receipt id>
near-vm-runner-standalone --context-file vmcontext.json --method-name get_status --wasm-file contract.wasm --state-file state.json --profile-gas --timings
```

Reproduce the third step need return data from step 2 (this is also same for any contract call that used as callback that takes return data from previous calls). To reproduce it first locate the receipt id from explorer (the one has content "Called method: 'get_from_other_callback'")

```
node index.js -a $REPRO_ACCOUNT -t $TXN -r <Your receipt id>
```

Obtain the return data from step 2's output (the "return_data" section)

```
{"outcome":{"balance":"169954889277699040312798592","storage_usage":346,"return_data":{"Value":"\u0001\u0003\u0000\u0000\u0000ooo"},"burnt_gas":201805752385,"used_gas":201805752385,"logs":["get_status for account_id repro.testnet"]},"err":null,"receipts":[],"state":{"U1RBVEU=":"AQAAAA0AAAByZXByby50ZXN0bmV0AwAAAG9vbw=="}}
```

Then run vm standalone with step 2's return data as promise_results:

```
./near-vm-runner-standalone --context-file vmcontext.json --method-name get_from_other_callback --wasm-file contract.wasm --state-file state.json --promise-results '{"Successful":"\u0001\u0003\u0000\u0000\u0000ooo"}'  --profile-gas --timings
```

## TODO

- [x] Check to ensure block hash is the correct one that "before" transaction and receipt execution, not after
- [x] Figure out pass promise results to cross contract calls
- [x] Figure out how to tell if a function call is a view programmatically:
  - view method is also executed as call, when execute as part of cross contract read
- [x] Add reproduce example that has cross contract read
