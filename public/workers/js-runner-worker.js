/**
 * JavaScript/TypeScript Web Worker — runs JS code in a sandboxed environment.
 *
 * Security note: same as pyodide-worker.js — network APIs blocked, this is a
 * practice tool with honor-system security.
 */

/* eslint-disable no-restricted-globals */

// Block network APIs before any user code executes
self.fetch = () => { throw new Error("Network access is disabled in the interview sandbox.") }
self.XMLHttpRequest = undefined
self.WebSocket = undefined

// Tree + List helpers injected into the execution scope
const TREE_HELPERS = `
class TreeNode {
  constructor(val = 0, left = null, right = null) {
    this.val = val; this.left = left; this.right = right;
  }
}
class ListNode {
  constructor(val = 0, next = null) {
    this.val = val; this.next = next;
  }
}
function _arrayToTree(arr) {
  if (!arr || arr.length === 0 || arr[0] === null) return null;
  const root = new TreeNode(arr[0]);
  const queue = [root];
  let i = 1;
  while (queue.length && i < arr.length) {
    const node = queue.shift();
    if (i < arr.length && arr[i] !== null) { node.left = new TreeNode(arr[i]); queue.push(node.left); }
    i++;
    if (i < arr.length && arr[i] !== null) { node.right = new TreeNode(arr[i]); queue.push(node.right); }
    i++;
  }
  return root;
}
function _treeToArray(root) {
  if (!root) return [];
  const result = []; const queue = [root];
  while (queue.length) {
    const node = queue.shift();
    if (node) { result.push(node.val); queue.push(node.left); queue.push(node.right); }
    else result.push(null);
  }
  while (result.length && result[result.length - 1] === null) result.pop();
  return result;
}
`

const TREE_INPUT_SLUGS = new Set(["binary-tree-level-order-traversal", "validate-bst"])
const CODEC_SLUGS = new Set(["serialize-deserialize-binary-tree"])
const CLASS_OPS_SLUGS = new Set(["min-stack"])

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function runUserCode(code) {
  // Evaluate user code in worker scope using indirect eval
  // This gives the user's functions a name in the global scope
  const fn = new Function(TREE_HELPERS + "\n" + code + "\n; return {TreeNode, ListNode, _arrayToTree, _treeToArray}")
  const exports = fn()
  // Make helpers available on self
  Object.assign(self, exports)
  // Evaluate again at top-level to register any named functions
  // eslint-disable-next-line no-eval
  eval(TREE_HELPERS + "\n" + code)
}

function callFn(fnName, input, slug) {
  const fn = self[fnName]

  if (CLASS_OPS_SLUGS.has(slug)) {
    const [ops, args] = input
    let inst = null
    const results = []
    for (let i = 0; i < ops.length; i++) {
      if (ops[i] === fnName) {
        const Cls = self[fnName]
        inst = new Cls(...(args[i] || []))
        results.push(null)
      } else {
        results.push(inst[ops[i]](...(args[i] || [])))
      }
    }
    return results
  }

  if (TREE_INPUT_SLUGS.has(slug)) {
    const root = self._arrayToTree(input[0])
    return fn(root, ...input.slice(1))
  }

  if (CODEC_SLUGS.has(slug)) {
    const root = self._arrayToTree(input[0])
    const codec = new self[fnName]()
    const serialized = codec.serialize(root)
    const deserialized = codec.deserialize(serialized)
    return self._treeToArray(deserialized)
  }

  if (typeof fn !== "function") throw new Error(`Function '${fnName}' not found`)
  return fn(...input)
}

function runTests(code, fnName, tests, slug) {
  const results = { passed: 0, failed: 0, totalWeight: 0, passedCount: 0, failedCount: 0, errors: [], runtimeMs: 0 }
  const start = performance.now()

  try {
    runUserCode(code)
  } catch (e) {
    for (let i = 0; i < tests.length; i++) {
      results.failed += tests[i].weight
      results.failedCount++
      results.totalWeight += tests[i].weight
      results.errors.push({ testIdx: i, error: String(e), expected: tests[i].expected, got: null })
    }
    results.runtimeMs = Math.round(performance.now() - start)
    return results
  }

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i]
    results.totalWeight += test.weight
    const testStart = performance.now()
    try {
      const got = callFn(fnName, test.input, slug || "")
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

    if (performance.now() - testStart > 5000) {
      // This test ran too long — stop remaining tests
      for (let j = i + 1; j < tests.length; j++) {
        results.failed += tests[j].weight
        results.failedCount++
        results.totalWeight += tests[j].weight
        results.errors.push({ testIdx: j, error: "Time limit exceeded (skipped after slow test)", expected: tests[j].expected, got: null })
      }
      break
    }
  }

  results.runtimeMs = Math.round(performance.now() - start)
  return results
}

self.onmessage = (e) => {
  const { type, code, fnName, tests, slug, id } = e.data

  if (type === "init") {
    self.postMessage({ type: "ready" })
    return
  }

  if (type === "run") {
    try {
      const result = runTests(code, fnName, tests, slug || "")
      self.postMessage({ type: "result", id, result })
    } catch (err) {
      self.postMessage({ type: "error", id, message: String(err) })
    }
  }
}
