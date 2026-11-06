# Local validation gate

Validated source: `008d267b85b6800b42b24d1a93731a72d722bfa7` (`local-validated-v1`).

`make container-smoke` completed with exit code 0 after the history rewrite:

- 27 contract tests and six API tests passed.
- Fuzz tests ran 256 cases each; the independent ledger checked 128 runs and 8,192 actions.
- Native and Docker APIs each prepared 13 locally signed transactions; receipts, balances, refunds, settlement and recovery were checked.
- The clean image ran as UID 1000, survived restart with identical chain-derived inventory, and rejected wrong-chain configuration.

Image: `sha256:f8112381947e32ad11cb556fe26323425ad7bd8c931709def9c85054f9d94feb`. Detailed compact evidence is in
[local-validation.json](../deployments/local-validation.json). These are ephemeral
Anvil transactions, not public-chain deployments.

Azure live validation is a separate, later gate.
