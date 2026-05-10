/**
 * JavaScript Web Worker — runs JS code in a sandboxed environment.
 *
 * Security note: network APIs are blocked. This is a practice tool with
 * honor-system security — users can inspect state via React devtools.
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

// Extract top-level declaration names from user code
function extractTopLevelNames(code) {
  const names = new Set()
  // function declarations
  for (const m of code.matchAll(/^function\s+(\w+)/gm)) names.add(m[1])
  // const / let / var assignments
  for (const m of code.matchAll(/^(?:const|let|var)\s+(\w+)/gm)) names.add(m[1])
  // class declarations
  for (const m of code.matchAll(/^class\s+(\w+)/gm)) names.add(m[1])
  return names
}

function runUserCode(code) {
  // Inject helpers + user code at global scope via indirect eval.
  // function declarations and var assignments become globals (self.*).
  // eslint-disable-next-line no-eval
  ;(0, eval)(TREE_HELPERS + "\n" + code)

  // const/let/class declarations don't leak to global scope via eval.
  // Extract them by running the code inside a Function that returns them.
  const names = extractTopLevelNames(code)
  if (names.size > 0) {
    const returnExpr = [...names]
      .map(n => `"${n}": typeof ${n} !== "undefined" ? ${n} : undefined`)
      .join(", ")
    try {
      const getter = new Function(TREE_HELPERS + "\n" + code + `\nreturn {${returnExpr}}`)
      const exports = getter()
      for (const [k, v] of Object.entries(exports)) {
        if (v !== undefined && typeof self[k] === "undefined") self[k] = v
      }
    } catch (_) {
      // ignore — the eval pass above will surface any real syntax errors
    }
  }
}

function callFn(fnName, input, slug) {
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
    return self[fnName](root, ...input.slice(1))
  }

  if (CODEC_SLUGS.has(slug)) {
    const root = self._arrayToTree(input[0])
    const codec = new self[fnName]()
    const serialized = codec.serialize(root)
    const deserialized = codec.deserialize(serialized)
    return self._treeToArray(deserialized)
  }

  const fn = self[fnName]
  if (typeof fn !== "function" && typeof fn !== "object") {
    throw new Error(`'${fnName}' is not defined. Make sure your function or class is named exactly '${fnName}'.`)
  }
  if (typeof fn !== "function") throw new Error(`'${fnName}' is not a function`)
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
