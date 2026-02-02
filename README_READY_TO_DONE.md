# Ready -> Done status patch

This patch adds a script that updates legacy API routes/UI code still checking:

  status === "ready"

The new ContentState uses:

  status === "done"

## Apply

1) Unzip into your OTG project root (same folder as package.json).
2) Run:

   node scripts/fix-ready-to-done-all.cjs

3) Then:

   npm run build

If you want to see what changed, the script prints the list of modified files.
