# Orange Belt meaningful commit plan

Use this sequence when presenting the repository history. Each commit should be
small, buildable where practical, and describe one reviewer-visible outcome.

1. chore: isolate Rise In workspace from production Sub Rosa
2. feat: add Freighter testnet wallet connection and disconnect
3. feat: display Horizon XLM balance with loading and errors
4. feat: submit signed testnet XLM payments and show tx hash
5. feat(contract): add educational round and commitment storage
6. test(contract): cover round creation, commits, and duplicate guards
7. feat(web): add Soroban create-round transaction flow
8. feat(web): hash and submit commit-style entries
9. feat(web): synchronize and display contract state
10. test(web): cover address, amount, and commitment validation
11. ci: verify frontend and Soroban contract on every change
12. docs: add Orange Belt deployment and evidence guide

Do not fabricate commit history. If the implementation was prepared in a
working tree, split it into these logical commits before submission and verify
each commit message with git log --oneline.

