import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fuzzyMatch } from '@/lib/h1b/uscis-parser'

// Regression guard for the substring-containment bug: short normalized company
// names ("Ati Holdings LLC" -> "ati") must NOT match unrelated employers whose
// names merely contain that substring mid-word (communic-ATI-ons, ph-ARM-a).
test('fuzzyMatch rejects mid-word substring false positives', () => {
  assert.equal(fuzzyMatch('CHARTER COMMUNICATIONS INC', 'Ati Holdings LLC'), false)
  assert.equal(fuzzyMatch('U S BANK NATIONAL ASSOCIATION', 'Ati Holdings LLC'), false)
  assert.equal(fuzzyMatch('RESEARCH CORP', 'Arch'), false)
  assert.equal(fuzzyMatch('PHARMA SOLUTIONS', 'ARM'), false)
  assert.equal(fuzzyMatch('INDUSTRIES INC', 'Dust'), false)
})

test('fuzzyMatch still matches the same and genuinely related employers', () => {
  assert.equal(fuzzyMatch('ATI HOLDINGS LLC', 'Ati Holdings LLC'), true)
  assert.equal(fuzzyMatch('ATI INC', 'Ati Holdings LLC'), true)
  assert.equal(fuzzyMatch('VISA U S A INC', 'Visa'), true)
  assert.equal(fuzzyMatch('AMAZON COM SERVICES LLC', 'Amazon'), true)
  assert.equal(fuzzyMatch('ARCH INSURANCE COMPANY', 'Arch'), true)
})
