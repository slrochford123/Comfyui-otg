import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("recognizes retired own CUDA children without ignoring unrelated or recycled PIDs", () => {
  const result=execFileSync("python3",["-c",`
import ast, pathlib, os
source=pathlib.Path('scripts/audio-editing-worker.py').read_text()
tree=ast.parse(source)
fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='is_owned_allocation')
scope={'os':os,'process_start':lambda pid:{101:'a',102:None,103:'reused',104:'d'}.get(pid)}
exec(compile(ast.Module(body=[fn],type_ignores=[]),'worker-test','exec'),scope)
owned={101:'a',102:'b',103:'c',105:None}
check=scope['is_owned_allocation']
assert check(os.getpid(),owned)
assert check(101,owned)
assert check(102,owned)
assert not check(103,owned)
assert not check(104,owned)
assert not check(105,owned)
print('passed')
`],{encoding:"utf8"});
  expect(result.trim()).toBe("passed");
});
