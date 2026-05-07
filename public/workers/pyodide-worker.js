/**
 * Pyodide Web Worker — runs Python code in a sandboxed environment.
 *
 * Security note: fetch, XMLHttpRequest, and WebSocket are overridden to throw
 * before any user code executes. This is a practice tool, not a proctored exam,
 * so a determined user can still inspect test data via devtools. The security
 * goal is preventing accidental or casual exfiltration from within user code.
 */

/* eslint-disable no-restricted-globals */

// Block network APIs before any user code can reference them
self.fetch = () => { throw new Error("Network access is disabled in the interview sandbox.") }
self.XMLHttpRequest = undefined
self.WebSocket = undefined
const _importScripts = self.importScripts.bind(self)
self.importScripts = () => { throw new Error("importScripts is disabled in this context.") }

let pyodide = null
let isReady = false

// Helper Python code injected into every execution context
const HELPERS_PY = `
import json

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

def _array_to_tree(arr):
    if not arr or arr[0] is None:
        return None
    root = TreeNode(arr[0])
    queue = [root]
    i = 1
    while queue and i < len(arr):
        node = queue.pop(0)
        if i < len(arr) and arr[i] is not None:
            node.left = TreeNode(arr[i])
            queue.append(node.left)
        i += 1
        if i < len(arr) and arr[i] is not None:
            node.right = TreeNode(arr[i])
            queue.append(node.right)
        i += 1
    return root

def _tree_to_array(root):
    if not root:
        return []
    result = []
    queue = [root]
    while queue:
        node = queue.pop(0)
        if node:
            result.append(node.val)
            queue.append(node.left)
            queue.append(node.right)
        else:
            result.append(None)
    while result and result[-1] is None:
        result.pop()
    return result

def _array_to_list(arr):
    if not arr:
        return None
    head = ListNode(arr[0])
    cur = head
    for v in arr[1:]:
        cur.next = ListNode(v)
        cur = cur.next
    return head

def _list_to_array(head):
    result = []
    while head:
        result.append(head.val)
        head = head.next
    return result
`

// Problems needing special input deserialization
const TREE_INPUT_SLUGS = new Set([
  "binary-tree-level-order-traversal",
  "validate-bst",
])
const CODEC_SLUGS = new Set(["serialize-deserialize-binary-tree"])
const CLASS_OPS_SLUGS = new Set(["min-stack"])

async function initPyodide() {
  try {
    _importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js")
    pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" })
    isReady = true
    self.postMessage({ type: "ready" })
  } catch (e) {
    self.postMessage({ type: "error", message: String(e) })
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function runTests(code, fnName, tests, slug) {
  const results = { passed: 0, failed: 0, totalWeight: 0, passedCount: 0, failedCount: 0, errors: [], runtimeMs: 0 }
  const start = performance.now()

  try {
    // Inject helpers + user code
    await pyodide.runPythonAsync(HELPERS_PY + "\n\n" + code)
  } catch (e) {
    // Syntax / import error — all tests fail
    for (const test of tests) {
      results.failed += test.weight
      results.failedCount++
      results.totalWeight += test.weight
      results.errors.push({ testIdx: tests.indexOf(test), error: String(e), expected: test.expected, got: null })
    }
    results.runtimeMs = performance.now() - start
    return results
  }

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i]
    results.totalWeight += test.weight

    // Per-test timeout via Promise.race
    const testPromise = runSingleTest(pyodide, fnName, test.input, test.expected, slug)
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Time limit exceeded (5s per test)")), 5000)
    )

    try {
      const got = await Promise.race([testPromise, timeoutPromise])
      if (deepEqual(got, test.expected)) {
        results.passed += test.weight
        results.passedCount++
      } else {
        results.failed += test.weight
        results.failedCount++
        results.errors.push({ testIdx: i, error: `Expected ${JSON.stringify(test.expected)}, got ${JSON.stringify(got)}`, expected: test.expected, got })
      }
    } catch (e) {
      results.failed += test.weight
      results.failedCount++
      results.errors.push({ testIdx: i, error: String(e), expected: test.expected, got: null })
    }
  }

  results.runtimeMs = Math.round(performance.now() - start)
  return results
}

async function runSingleTest(py, fnName, input, expected, slug) {
  if (CLASS_OPS_SLUGS.has(slug)) {
    // Class-based operations protocol
    // input = [operations_array, args_array]
    const [ops, args] = input
    const script = `
_ops = ${JSON.stringify(ops)}
_args = ${JSON.stringify(args)}
_cls = ${fnName}
_inst = None
_results = []
for _op, _arg in zip(_ops, _args):
    if _op == "${fnName}":
        _inst = _cls(*_arg)
        _results.append(None)
    else:
        _r = getattr(_inst, _op)(*_arg)
        _results.append(_r)
import json
json.dumps(_results)
`
    const raw = await py.runPythonAsync(script)
    return JSON.parse(raw)
  }

  if (TREE_INPUT_SLUGS.has(slug)) {
    // Deserialize first arg from array to TreeNode
    const script = `
import json
_root = _array_to_tree(${JSON.stringify(input[0])})
_extra = ${JSON.stringify(input.slice(1))}
_result = ${fnName}(_root, *_extra)
json.dumps(_result)
`
    const raw = await py.runPythonAsync(script)
    return JSON.parse(raw)
  }

  if (CODEC_SLUGS.has(slug)) {
    // Round-trip: build tree, serialize, deserialize, compare tree-to-array
    const script = `
import json
_tree_arr = ${JSON.stringify(input[0])}
_root = _array_to_tree(_tree_arr)
_codec = Codec()
_serialized = _codec.serialize(_root)
_deserialized = _codec.deserialize(_serialized)
json.dumps(_tree_to_array(_deserialized))
`
    const raw = await py.runPythonAsync(script)
    return JSON.parse(raw)
  }

  // Standard: spread args
  const script = `
import json
_args = ${JSON.stringify(input)}
_result = ${fnName}(*_args)
json.dumps(_result)
`
  const raw = await py.runPythonAsync(script)
  return JSON.parse(raw)
}

self.onmessage = async (e) => {
  const { type, code, fnName, tests, slug, id } = e.data

  if (type === "init") {
    await initPyodide()
    return
  }

  if (type === "run") {
    if (!isReady) {
      self.postMessage({ type: "error", id, message: "Pyodide not ready" })
      return
    }
    try {
      const result = await runTests(code, fnName, tests, slug || "")
      self.postMessage({ type: "result", id, result })
    } catch (e) {
      self.postMessage({ type: "error", id, message: String(e) })
    }
  }
}
