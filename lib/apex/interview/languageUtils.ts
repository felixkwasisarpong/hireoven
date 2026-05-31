/**
 * Language utilities for the coding interview runner.
 * Handles Python signature parsing, type mapping, and harness generation for
 * server-side languages (TypeScript, Go, Java) executed via Piston.
 */

export type CodingLanguage = "python" | "javascript" | "typescript" | "go" | "java"

export const SERVER_SIDE_LANGUAGES = new Set<CodingLanguage>(["typescript", "go", "java"])

export interface ParsedSignature {
  fnName: string
  params: Array<{ name: string; pyType: string }>
  returnType: string
}

// ── Python signature parser ──────────────────────────────────────────────────

export function parsePythonSignature(pyStr: string): ParsedSignature | null {
  const match = pyStr.match(/def\s+(\w+)\s*\((.*?)\)\s*->\s*([^:{]+):?/)
  if (!match) return null

  const [, fnName, paramsStr, returnTypeRaw] = match
  const returnType = returnTypeRaw.trim()
  const params: Array<{ name: string; pyType: string }> = []

  if (paramsStr.trim()) {
    for (const p of paramsStr.split(',')) {
      const parts = p.split(':').map(s => s.trim())
      const name = parts[0].replace(/[*?]/, '').trim()
      if (name === 'self' || !name) continue
      params.push({ name, pyType: parts[1] ?? 'Any' })
    }
  }

  return { fnName, params, returnType }
}

// ── Type mappers ─────────────────────────────────────────────────────────────

export function pyTypeToGo(pyType: string): string {
  const t = pyType.trim()
  if (t === 'int') return 'int'
  if (t === 'float') return 'float64'
  if (t === 'str') return 'string'
  if (t === 'bool') return 'bool'
  if (t === 'None') return ''
  if (t.startsWith('list[') || t.startsWith('List[')) return '[]' + pyTypeToGo(t.slice(5, -1))
  if (t.startsWith('Optional[')) return '*' + pyTypeToGo(t.slice(9, -1))
  return 'interface{}'
}

export function pyTypeToJava(pyType: string): string {
  const t = pyType.trim()
  if (t === 'int') return 'int'
  if (t === 'float') return 'double'
  if (t === 'str') return 'String'
  if (t === 'bool') return 'boolean'
  if (t === 'None') return 'void'
  if (t.startsWith('list[') || t.startsWith('List[')) return pyTypeToJava(t.slice(5, -1)) + '[]'
  if (t.startsWith('Optional[')) return pyTypeToJava(t.slice(9, -1))
  return 'Object'
}

// ── Literal generators ───────────────────────────────────────────────────────

export function jsonToGoLiteral(value: unknown, goType: string): string {
  if (goType === 'int' || goType === 'float64') return String(value)
  if (goType === 'bool') return String(value)
  if (goType === 'string') return JSON.stringify(value)
  if (goType.startsWith('[]')) {
    const arr = value as unknown[]
    const inner = goType.slice(2)
    if (!arr || arr.length === 0) return `${goType}{}`
    return `${goType}{${arr.map(v => jsonToGoLiteral(v, inner)).join(', ')}}`
  }
  return JSON.stringify(JSON.stringify(value))
}

export function jsonToJavaLiteral(value: unknown, javaType: string): string {
  if (javaType === 'int' || javaType === 'double') return String(value)
  if (javaType === 'boolean') return String(value)
  if (javaType === 'String') return JSON.stringify(value)
  if (javaType.endsWith('[]')) {
    const arr = value as unknown[]
    const inner = javaType.slice(0, -2)
    if (!arr || arr.length === 0) return `new ${inner}[]{}`
    return `new ${inner}[]{${arr.map(v => jsonToJavaLiteral(v, inner)).join(', ')}}`
  }
  return String(value)
}

// ── Starter code generators ──────────────────────────────────────────────────

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

function zeroValueGo(t: string): string {
  if (t === 'int' || t === 'float64') return '0'
  if (t === 'bool') return 'false'
  if (t === 'string') return '""'
  return 'nil'
}

function zeroValueJava(t: string): string {
  if (t === 'int' || t === 'double') return '0'
  if (t === 'boolean') return 'false'
  return 'null'
}

export function generateGoStarter(sig: ParsedSignature): string {
  const name = snakeToCamel(sig.fnName)
  const ret = pyTypeToGo(sig.returnType)
  const params = sig.params.map(p => `${snakeToCamel(p.name)} ${pyTypeToGo(p.pyType)}`).join(', ')
  return `func ${name}(${params}) ${ret} {\n\t// your code here\n\treturn ${zeroValueGo(ret)}\n}`
}

export function generateJavaStarter(sig: ParsedSignature): string {
  const name = snakeToCamel(sig.fnName)
  const ret = pyTypeToJava(sig.returnType)
  const params = sig.params.map(p => `${pyTypeToJava(p.pyType)} ${snakeToCamel(p.name)}`).join(', ')
  return `public ${ret} ${name}(${params}) {\n    // your code here\n    return ${zeroValueJava(ret)};\n}`
}

// ── Program (harness) generators ─────────────────────────────────────────────

interface TestCase {
  input: unknown[]
  expected: unknown
  weight: number
}

export function generateGoProgram(
  userCode: string,
  sig: ParsedSignature,
  tests: TestCase[]
): string {
  const name = snakeToCamel(sig.fnName)
  const retType = pyTypeToGo(sig.returnType)

  const blocks = tests.map((t, i) => {
    const args = t.input
      .map((v, j) => jsonToGoLiteral(v, pyTypeToGo(sig.params[j]?.pyType ?? 'interface{}')))
      .join(', ')
    const exp = jsonToGoLiteral(t.expected, retType)
    return `
	// Test ${i}
	{
		got := ${name}(${args})
		exp := ${exp}
		total += ${t.weight}
		gJ, _ := json.Marshal(got)
		eJ, _ := json.Marshal(exp)
		if string(gJ) == string(eJ) {
			passed += ${t.weight}; pc++
		} else {
			failed += ${t.weight}; fc++
			errs = append(errs, map[string]interface{}{"testIdx": ${i}, "error": fmt.Sprintf("expected %v, got %v", exp, got)})
		}
	}`
  }).join('')

  return `package main

import (
	"encoding/json"
	"fmt"
	"time"
)

// ─── User Solution ────────────────────────────────────────────────────────────
${userCode}

// ─── Test Runner ─────────────────────────────────────────────────────────────
func main() {
	start := time.Now()
	passed, failed, total := 0.0, 0.0, 0.0
	pc, fc := 0, 0
	errs := []map[string]interface{}{}
${blocks}
	ms := int(time.Since(start).Milliseconds())
	out, _ := json.Marshal(map[string]interface{}{
		"passed": passed, "failed": failed, "totalWeight": total,
		"passedCount": pc, "failedCount": fc, "errors": errs, "runtimeMs": ms,
	})
	fmt.Println(string(out))
}
`
}

export function generateJavaProgram(
  userCode: string,
  sig: ParsedSignature,
  tests: TestCase[]
): string {
  const name = snakeToCamel(sig.fnName)
  const retType = pyTypeToJava(sig.returnType)

  const blocks = tests.map((t, i) => {
    const args = t.input
      .map((v, j) => jsonToJavaLiteral(v, pyTypeToJava(sig.params[j]?.pyType ?? 'Object')))
      .join(', ')
    const exp = jsonToJavaLiteral(t.expected, retType)
    const eq = javaEqualExpr('got', 'exp', retType)
    return `
        // Test ${i}
        {
            ${retType} got = sol.${name}(${args});
            ${retType} exp = ${exp};
            total += ${t.weight};
            if (${eq}) { passed += ${t.weight}; pc++; }
            else {
                failed += ${t.weight}; fc++;
                errs.append(",{\\"testIdx\\":${i},\\"error\\":\\"expected \\" + jStr(exp) + \\", got \\" + jStr(got) + \\"}");
            }
        }`
  }).join('')

  return `import java.util.*;

public class Main {
    static class Solution {
        ${userCode}
    }

    static String jStr(Object o) {
        if (o == null) return "null";
        if (o instanceof int[]) return Arrays.toString((int[]) o);
        if (o instanceof int[][]) return Arrays.deepToString((int[][]) o);
        if (o instanceof String[]) return Arrays.toString((String[]) o);
        if (o instanceof boolean[]) return Arrays.toString((boolean[]) o);
        return String.valueOf(o);
    }

    static boolean eq(Object a, Object b) {
        if (a instanceof int[] && b instanceof int[]) return Arrays.equals((int[])a, (int[])b);
        if (a instanceof int[][] && b instanceof int[][]) return Arrays.deepEquals((int[][])a, (int[][])b);
        if (a instanceof String[] && b instanceof String[]) return Arrays.equals((String[])a, (String[])b);
        if (a instanceof boolean[] && b instanceof boolean[]) return Arrays.equals((boolean[])a, (boolean[])b);
        if (a == null) return b == null;
        return a.equals(b);
    }

    public static void main(String[] args) {
        Solution sol = new Solution();
        long start = System.currentTimeMillis();
        double passed = 0, failed = 0, total = 0;
        int pc = 0, fc = 0;
        StringBuilder errs = new StringBuilder();
${blocks}
        long ms = System.currentTimeMillis() - start;
        System.out.println("{\\"passed\\":" + passed + ",\\"failed\\":" + failed +
            ",\\"totalWeight\\":" + total + ",\\"passedCount\\":" + pc +
            ",\\"failedCount\\":" + fc + ",\\"runtimeMs\\":" + ms +
            ",\\"errors\\":[" + (errs.length() > 0 ? errs.substring(1) : "") + "]}");
    }
}
`
}

function javaEqualExpr(a: string, b: string, javaType: string): string {
  if (javaType === 'int' || javaType === 'boolean' || javaType === 'double') return `${a} == ${b}`
  return `eq(${a}, ${b})`
}

// ── TypeScript JS-compat harness (for Piston ts-node) ────────────────────────

export function generateTsProgram(userCode: string, tests: TestCase[], fnName: string): string {
  const testsJson = JSON.stringify(tests)
  return `// ─── User Solution ───────────────────────────────────────────────────────────
${userCode}

// ─── Test Runner ─────────────────────────────────────────────────────────────
const tests: Array<{input: unknown[]; expected: unknown; weight: number}> = ${testsJson}
const fn = eval("${fnName}") as (...args: unknown[]) => unknown

let passed = 0, failed = 0, total = 0, passedCount = 0, failedCount = 0
const errors: unknown[] = []
const start = Date.now()

for (let i = 0; i < tests.length; i++) {
  const { input, expected, weight } = tests[i]
  total += weight
  try {
    const got = fn(...input)
    if (JSON.stringify(got) === JSON.stringify(expected)) {
      passed += weight; passedCount++
    } else {
      failed += weight; failedCount++
      errors.push({ testIdx: i, error: \`expected \${JSON.stringify(expected)}, got \${JSON.stringify(got)}\`, expected, got })
    }
  } catch (e: unknown) {
    failed += weight; failedCount++
    errors.push({ testIdx: i, error: String(e), expected, got: null })
  }
}

console.log(JSON.stringify({ passed, failed, totalWeight: total, passedCount, failedCount, errors, runtimeMs: Date.now() - start }))
`
}
