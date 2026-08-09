from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: normalize-actions-policy-r4f-g3-dual.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()
old = '''  r4c2c-devnet-historical-witness.yml
  r4f-g3-isolated-window.yml
  r4f-g3-one-shot-probe.yml
  r4f-g3-dual-provider-verdict.yml
  r5-bounded-recovery-burst.yml'''
new = '''  r4c2c-devnet-historical-witness.yml
  r4f-g3-dual-provider-verdict.yml
  r4f-g3-isolated-window.yml
  r4f-g3-one-shot-probe.yml
  r5-bounded-recovery-burst.yml'''
if text.count(old) != 1:
    raise SystemExit('generated G3 workflow allowlist block is not uniquely patchable')
path.write_text(text.replace(old, new))
