# Tool to get enough information for reproduce NEAR contract execution locally

## Usage

```
npm i
node index.js -a <txn sender> -t <txn hash>
```

It will download `state.json`, `vmcontext.json` and `contract.wasm`, which can be pass to near-vm-runner-standalone

## TODO

Transaction with multiple actions and cross contract call is not yet supported
