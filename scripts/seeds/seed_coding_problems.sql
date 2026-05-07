-- =============================================================
-- Seed: 30 coding problems  (10 easy · 15 medium · 5 hard)
-- =============================================================

-- ─── EASY 1 ──────────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'two-sum',
  'Two Sum',
  'easy',
  'any',
  $$Given an array of integers `nums` and an integer `target`, return the indices of the two numbers such that they add up to `target`.

You may assume that each input has exactly one solution, and you may not use the same element twice. You can return the answer in any order.

**Example 1:**
Input: `nums = [2,7,11,15]`, `target = 9`
Output: `[0,1]`

**Example 2:**
Input: `nums = [3,2,4]`, `target = 6`
Output: `[1,2]`

**Constraints:**
- 2 ≤ nums.length ≤ 10⁴
- -10⁹ ≤ nums[i] ≤ 10⁹
- Only one valid answer exists.$$,
  '{"python": "def two_sum(nums: list[int], target: int) -> list[int]:\n    pass", "javascript": "function twoSum(nums, target) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": [[2,7,11,15], 9],        "expected": [0,1],  "weight": 1},
    {"input": [[3,2,4], 6],            "expected": [1,2],  "weight": 1},
    {"input": [[3,3], 6],              "expected": [0,1],  "weight": 2},
    {"input": [[-1,-2,-3,-4,-5], -8],  "expected": [2,4],  "weight": 2},
    {"input": [[0,4,3,0], 0],          "expected": [0,3],  "weight": 2}
  ]'::jsonb,
  '["Think about what information you need to remember as you scan the array.", "A hashmap lets you look up the complement (target − current number) in O(1) time.", "Walk the array once. For each number, check if (target − num) is already in the map. If yes, return both indices. If no, store num → index in the map."]'::jsonb,
  15,
  ARRAY['arrays', 'hashmap']
);

-- ─── EASY 2 ──────────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'valid-anagram',
  'Valid Anagram',
  'easy',
  'any',
  $$Given two strings `s` and `t`, return `true` if `t` is an anagram of `s`, and `false` otherwise.

An anagram is a word formed by rearranging the letters of another word, using all the original letters exactly once.

**Example 1:**
Input: `s = "anagram"`, `t = "nagaram"`
Output: `true`

**Example 2:**
Input: `s = "rat"`, `t = "car"`
Output: `false`

**Constraints:**
- 1 ≤ s.length, t.length ≤ 5 × 10⁴
- s and t consist of lowercase English letters.$$,
  '{"python": "def is_anagram(s: str, t: str) -> bool:\n    pass", "javascript": "function isAnagram(s, t) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": ["anagram", "nagaram"],  "expected": true,  "weight": 1},
    {"input": ["rat", "car"],          "expected": false, "weight": 1},
    {"input": ["", ""],                "expected": true,  "weight": 2},
    {"input": ["a", "ab"],             "expected": false, "weight": 2},
    {"input": ["aab", "bba"],          "expected": false, "weight": 2}
  ]'::jsonb,
  '["Two strings that are anagrams must have the same length — check that first.", "A frequency map (character → count) lets you compare both strings without sorting.", "Build a frequency map for s, then decrement for each character in t. If any count goes negative, or if the maps differ, return false."]'::jsonb,
  15,
  ARRAY['strings', 'hashmap']
);

-- ─── EASY 3 ──────────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'reverse-string',
  'Reverse String',
  'easy',
  'any',
  $$Write a function that reverses a string and returns it. The input is given as a string `s`.

**Example 1:**
Input: `s = "hello"`
Output: `"olleh"`

**Example 2:**
Input: `s = "Hannah"`
Output: `"hannaH"`

**Constraints:**
- 1 ≤ s.length ≤ 10⁵
- s[i] is a printable ASCII character.$$,
  '{"python": "def reverse_string(s: str) -> str:\n    pass", "javascript": "function reverseString(s) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": ["hello"],   "expected": "olleh",  "weight": 1},
    {"input": ["Hannah"],  "expected": "hannaH", "weight": 1},
    {"input": ["a"],       "expected": "a",      "weight": 2},
    {"input": ["ab"],      "expected": "ba",      "weight": 1},
    {"input": ["abcde"],   "expected": "edcba",  "weight": 1}
  ]'::jsonb,
  '["Think about the relationship between the first and last characters — and the second and second-to-last, and so on.", "Two pointers (one at each end) can swap characters and move inward without extra space.", "Start with left = 0, right = len - 1. Swap s[left] and s[right], then move left forward and right backward until they meet."]'::jsonb,
  15,
  ARRAY['strings', 'two_pointers']
);

-- ─── EASY 4 ──────────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'contains-duplicate',
  'Contains Duplicate',
  'easy',
  'any',
  $$Given an integer array `nums`, return `true` if any value appears at least twice in the array, and `false` if every element is distinct.

**Example 1:**
Input: `nums = [1,2,3,1]`
Output: `true`

**Example 2:**
Input: `nums = [1,2,3,4]`
Output: `false`

**Constraints:**
- 1 ≤ nums.length ≤ 10⁵
- -10⁹ ≤ nums[i] ≤ 10⁹$$,
  '{"python": "def contains_duplicate(nums: list[int]) -> bool:\n    pass", "javascript": "function containsDuplicate(nums) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": [[1,2,3,1]],           "expected": true,  "weight": 1},
    {"input": [[1,2,3,4]],           "expected": false, "weight": 1},
    {"input": [[1]],                  "expected": false, "weight": 2},
    {"input": [[1,1,1,3,3,4,3,2,4,2]], "expected": true, "weight": 1},
    {"input": [[-1,0,1,-1]],         "expected": true,  "weight": 2}
  ]'::jsonb,
  '["If you have seen a number before, you know there is a duplicate — what data structure tracks \"seen\" elements efficiently?", "A set lets you check membership in O(1) and automatically rejects duplicates.", "Walk the array; for each number, if it is already in the set return true, otherwise add it. Return false if you finish the loop."]'::jsonb,
  15,
  ARRAY['arrays', 'hashmap']
);

-- ─── EASY 5 ──────────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'valid-parentheses',
  'Valid Parentheses',
  'easy',
  'any',
  $$Given a string `s` containing just the characters `(`, `)`, `{`, `}`, `[` and `]`, determine if the input string is valid.

An input string is valid if:
1. Open brackets must be closed by the same type of brackets.
2. Open brackets must be closed in the correct order.
3. Every close bracket has a corresponding open bracket of the same type.

**Example 1:**
Input: `s = "()"`
Output: `true`

**Example 2:**
Input: `s = "([)]"`
Output: `false`

**Constraints:**
- 1 ≤ s.length ≤ 10⁴
- s consists of parentheses only: `()[]{}`.$$,
  '{"python": "def is_valid(s: str) -> bool:\n    pass", "javascript": "function isValid(s) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": ["()"],      "expected": true,  "weight": 1},
    {"input": ["()[]{}"],  "expected": true,  "weight": 1},
    {"input": ["(]"],      "expected": false, "weight": 1},
    {"input": ["([)]"],    "expected": false, "weight": 2},
    {"input": ["{[]}"],    "expected": true,  "weight": 2}
  ]'::jsonb,
  '["You need to match the most recently opened bracket — that sounds like a last-in-first-out structure.", "A stack is ideal here: push opening brackets, and pop when you see a closing bracket to check for a match.", "Push every open bracket. When you see a closing bracket, pop the top of the stack and check if it is the matching open bracket. Return true only if the stack is empty at the end."]'::jsonb,
  15,
  ARRAY['strings', 'stack_queue']
);

-- ─── EASY 6 ──────────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'merge-two-sorted-lists',
  'Merge Two Sorted Lists',
  'easy',
  'any',
  $$You are given two sorted integer arrays `list1` and `list2` (each representing a sorted linked list). Merge the two sorted lists and return it as one sorted array.

**Example 1:**
Input: `list1 = [1,2,4]`, `list2 = [1,3,4]`
Output: `[1,1,2,3,4,4]`

**Example 2:**
Input: `list1 = []`, `list2 = [0]`
Output: `[0]`

**Constraints:**
- 0 ≤ list1.length, list2.length ≤ 50
- -100 ≤ list1[i], list2[i] ≤ 100
- Both list1 and list2 are sorted in non-decreasing order.$$,
  '{"python": "def merge_two_lists(list1: list[int], list2: list[int]) -> list[int]:\n    pass", "javascript": "function mergeTwoLists(list1, list2) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": [[1,2,4], [1,3,4]],  "expected": [1,1,2,3,4,4], "weight": 1},
    {"input": [[], []],            "expected": [],             "weight": 2},
    {"input": [[], [0]],           "expected": [0],            "weight": 2},
    {"input": [[1], [2]],          "expected": [1,2],          "weight": 1},
    {"input": [[1,3,5], [2,4,6]], "expected": [1,2,3,4,5,6],  "weight": 1}
  ]'::jsonb,
  '["Both lists are already sorted — think about how to combine two sorted sequences into one without sorting from scratch.", "Two pointers (one per list) let you always pick the smaller front element in O(1).", "Use two indices i and j. Append the smaller of list1[i] and list2[j] to the result, advance that pointer, and repeat until one list is exhausted. Append the remainder of the other list."]'::jsonb,
  15,
  ARRAY['linked_list']
);

-- ─── EASY 7 ──────────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'best-time-to-buy-sell-stock',
  'Best Time to Buy and Sell Stock',
  'easy',
  'any',
  $$You are given an array `prices` where `prices[i]` is the price of a given stock on the i-th day.

You want to maximize your profit by choosing a single day to buy one stock and choosing a different day in the future to sell that stock.

Return the maximum profit you can achieve from this transaction. If you cannot achieve any profit, return `0`.

**Example 1:**
Input: `prices = [7,1,5,3,6,4]`
Output: `5`
Explanation: Buy on day 2 (price = 1), sell on day 5 (price = 6), profit = 5.

**Example 2:**
Input: `prices = [7,6,4,3,1]`
Output: `0`
Explanation: Prices only decrease, so no profit is possible.

**Constraints:**
- 1 ≤ prices.length ≤ 10⁵
- 0 ≤ prices[i] ≤ 10⁴$$,
  '{"python": "def max_profit(prices: list[int]) -> int:\n    pass", "javascript": "function maxProfit(prices) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": [[7,1,5,3,6,4]],  "expected": 5, "weight": 1},
    {"input": [[7,6,4,3,1]],    "expected": 0, "weight": 1},
    {"input": [[1]],             "expected": 0, "weight": 2},
    {"input": [[1,2]],           "expected": 1, "weight": 1},
    {"input": [[2,4,1,7]],       "expected": 6, "weight": 2}
  ]'::jsonb,
  '["You must buy before you sell. As you scan forward, what is the best price you could have bought at up to this point?", "Track the minimum price seen so far. The best profit at any day is price[i] − min_so_far.", "Single pass: maintain min_price and max_profit. For each price, update max_profit = max(max_profit, price − min_price), then update min_price = min(min_price, price)."]'::jsonb,
  15,
  ARRAY['arrays']
);

-- ─── EASY 8 ──────────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'palindrome-check',
  'Palindrome Check',
  'easy',
  'any',
  $$Given a string `s`, return `true` if it is a palindrome, or `false` otherwise.

A string is a palindrome if it reads the same forward and backward.

**Example 1:**
Input: `s = "racecar"`
Output: `true`

**Example 2:**
Input: `s = "hello"`
Output: `false`

**Constraints:**
- 0 ≤ s.length ≤ 2 × 10⁵
- s consists of printable ASCII characters.$$,
  '{"python": "def is_palindrome(s: str) -> bool:\n    pass", "javascript": "function isPalindrome(s) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": ["racecar"],  "expected": true,  "weight": 1},
    {"input": ["hello"],    "expected": false, "weight": 1},
    {"input": ["a"],        "expected": true,  "weight": 2},
    {"input": [""],         "expected": true,  "weight": 2},
    {"input": ["abba"],     "expected": true,  "weight": 1}
  ]'::jsonb,
  '["A palindrome mirrors itself — the character at position i equals the character at position (length − 1 − i).", "Two pointers starting at opposite ends can compare characters and move inward, stopping early if a mismatch is found.", "Set left = 0, right = len − 1. While left < right, compare s[left] and s[right]. If they differ, return false. Otherwise advance both pointers. Return true if no mismatch was found."]'::jsonb,
  15,
  ARRAY['strings', 'two_pointers']
);

-- ─── EASY 9 ──────────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'fizzbuzz',
  'FizzBuzz',
  'easy',
  'any',
  $$Given an integer `n`, return a string array where:
- `answer[i] == "FizzBuzz"` if i is divisible by both 3 and 5.
- `answer[i] == "Fizz"` if i is divisible by 3.
- `answer[i] == "Buzz"` if i is divisible by 5.
- `answer[i] == i` (as a string) otherwise.

The array is 1-indexed: answer contains strings for i = 1, 2, ..., n.

**Example 1:**
Input: `n = 5`
Output: `["1","2","Fizz","4","Buzz"]`

**Example 2:**
Input: `n = 15`
Output: `["1","2","Fizz","4","Buzz","Fizz","7","8","Fizz","Buzz","11","Fizz","13","14","FizzBuzz"]`

**Constraints:**
- 1 ≤ n ≤ 10⁴$$,
  '{"python": "def fizz_buzz(n: int) -> list[str]:\n    pass", "javascript": "function fizzBuzz(n) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": [1],  "expected": ["1"],                                                                                                  "weight": 1},
    {"input": [3],  "expected": ["1","2","Fizz"],                                                                                       "weight": 1},
    {"input": [5],  "expected": ["1","2","Fizz","4","Buzz"],                                                                            "weight": 1},
    {"input": [15], "expected": ["1","2","Fizz","4","Buzz","Fizz","7","8","Fizz","Buzz","11","Fizz","13","14","FizzBuzz"],              "weight": 2},
    {"input": [20], "expected": ["1","2","Fizz","4","Buzz","Fizz","7","8","Fizz","Buzz","11","Fizz","13","14","FizzBuzz","16","17","Fizz","19","Buzz"], "weight": 2}
  ]'::jsonb,
  '["The FizzBuzz condition (divisible by both 3 and 5) must be checked before the individual Fizz and Buzz conditions, otherwise it will never be reached.", "Use the modulo operator (%) to test divisibility. Check for 15 first (or equivalently check 3 and 5 together), then 3, then 5, then fall through to the number itself.", "Loop i from 1 to n. Build the result string: if i % 15 == 0 → \"FizzBuzz\"; else if i % 3 == 0 → \"Fizz\"; else if i % 5 == 0 → \"Buzz\"; else → str(i)."]'::jsonb,
  15,
  ARRAY['strings']
);

-- ─── EASY 10 ─────────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'maximum-subarray',
  'Maximum Subarray',
  'easy',
  'any',
  $$Given an integer array `nums`, find the contiguous subarray (containing at least one number) which has the largest sum and return its sum.

**Example 1:**
Input: `nums = [-2,1,-3,4,-1,2,1,-5,4]`
Output: `6`
Explanation: The subarray `[4,-1,2,1]` has the largest sum 6.

**Example 2:**
Input: `nums = [5,4,-1,7,8]`
Output: `23`

**Constraints:**
- 1 ≤ nums.length ≤ 10⁵
- -10⁴ ≤ nums[i] ≤ 10⁴$$,
  '{"python": "def max_subarray(nums: list[int]) -> int:\n    pass", "javascript": "function maxSubarray(nums) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": [[-2,1,-3,4,-1,2,1,-5,4]],  "expected": 6,  "weight": 1},
    {"input": [[1]],                        "expected": 1,  "weight": 2},
    {"input": [[5,4,-1,7,8]],              "expected": 23, "weight": 1},
    {"input": [[-3,-1,-2]],                "expected": -1, "weight": 2},
    {"input": [[-2,-3,4,-1,-2,1,5,-3]],   "expected": 7,  "weight": 2}
  ]'::jsonb,
  '["At each position, you have a choice: extend the previous subarray, or start a fresh subarray from the current element.", "Kadane''s algorithm maintains a \"current\" running sum. When that sum drops below the current element, restart from the current element.", "Track current_sum and max_sum. For each num: current_sum = max(num, current_sum + num). Then max_sum = max(max_sum, current_sum). Return max_sum."]'::jsonb,
  15,
  ARRAY['arrays', 'dp']
);

-- ─── MEDIUM 11 ───────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'group-anagrams',
  'Group Anagrams',
  'medium',
  'any',
  $$Given an array of strings `strs`, group the anagrams together. You can return the answer in any order. Within each group, strings should be sorted alphabetically, and groups should be sorted by their first element.

An anagram is a word formed by rearranging the letters of another word, using all the original letters exactly once.

**Example 1:**
Input: `strs = ["eat","tea","tan","ate","nat","bat"]`
Output: `[["ate","eat","tea"],["bat"],["nat","tan"]]`

**Example 2:**
Input: `strs = [""]`
Output: `[[""]]`

**Constraints:**
- 1 ≤ strs.length ≤ 10⁴
- 0 ≤ strs[i].length ≤ 100
- strs[i] consists of lowercase English letters.$$,
  '{"python": "def group_anagrams(strs: list[str]) -> list[list[str]]:\n    pass", "javascript": "function groupAnagrams(strs) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": [["eat","tea","tan","ate","nat","bat"]], "expected": [["ate","eat","tea"],["bat"],["nat","tan"]], "weight": 1},
    {"input": [[""]], "expected": [[""]], "weight": 2},
    {"input": [["a"]], "expected": [["a"]], "weight": 1},
    {"input": [["ab","ba","cd","dc","ef"]], "expected": [["ab","ba"],["cd","dc"],["ef"]], "weight": 2},
    {"input": [["hman","nahm","abcd","dcba"]], "expected": [["abcd","dcba"],["hman","nahm"]], "weight": 2}
  ]'::jsonb,
  '["Two words are anagrams if and only if they have the same characters in the same frequencies — what concise representation captures that?", "Sorting the characters of a word gives a canonical key: all anagrams map to the same sorted string.", "Use a hashmap keyed by the sorted version of each word. Append each word to the list for its key. Return the grouped lists, sorted for determinism."]'::jsonb,
  30,
  ARRAY['strings', 'hashmap']
);

-- ─── MEDIUM 12 ───────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'longest-substring-without-repeating',
  'Longest Substring Without Repeating Characters',
  'medium',
  'any',
  $$Given a string `s`, find the length of the longest substring without repeating characters.

**Example 1:**
Input: `s = "abcabcbb"`
Output: `3`
Explanation: The answer is `"abc"`, with the length of 3.

**Example 2:**
Input: `s = "pwwkew"`
Output: `3`
Explanation: The answer is `"wke"`, with the length of 3.

**Constraints:**
- 0 ≤ s.length ≤ 5 × 10⁴
- s consists of English letters, digits, symbols and spaces.$$,
  '{"python": "def length_of_longest_substring(s: str) -> int:\n    pass", "javascript": "function lengthOfLongestSubstring(s) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": ["abcabcbb"],                    "expected": 3,  "weight": 1},
    {"input": ["bbbbb"],                       "expected": 1,  "weight": 1},
    {"input": ["pwwkew"],                      "expected": 3,  "weight": 1},
    {"input": [""],                            "expected": 0,  "weight": 2},
    {"input": ["abcdefghijklmnopqrstuvwxyz"],  "expected": 26, "weight": 2}
  ]'::jsonb,
  '["If you expand a window to the right and hit a duplicate character, you need to shrink from the left — but only until the duplicate is removed.", "A sliding window with a set (or character-to-index map) tracks the current window without repeating characters.", "Use left and right pointers. Expand right; when s[right] is already in the window, advance left until the duplicate is gone. Track max window size throughout."]'::jsonb,
  30,
  ARRAY['strings', 'sliding_window']
);

-- ─── MEDIUM 13 ───────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  '3sum',
  '3Sum',
  'medium',
  'any',
  $$Given an integer array `nums`, return all the triplets `[nums[i], nums[j], nums[k]]` such that `i != j`, `i != k`, and `j != k`, and `nums[i] + nums[j] + nums[k] == 0`.

The solution set must not contain duplicate triplets. Return triplets sorted internally and the list of triplets sorted lexicographically.

**Example 1:**
Input: `nums = [-1,0,1,2,-1,-4]`
Output: `[[-1,-1,2],[-1,0,1]]`

**Example 2:**
Input: `nums = [0,0,0]`
Output: `[[0,0,0]]`

**Constraints:**
- 3 ≤ nums.length ≤ 3000
- -10⁵ ≤ nums[i] ≤ 10⁵$$,
  '{"python": "def three_sum(nums: list[int]) -> list[list[int]]:\n    pass", "javascript": "function threeSum(nums) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": [[-1,0,1,2,-1,-4]],   "expected": [[-1,-1,2],[-1,0,1]], "weight": 1},
    {"input": [[0,1,1]],            "expected": [],                    "weight": 1},
    {"input": [[0,0,0]],            "expected": [[0,0,0]],             "weight": 2},
    {"input": [[-2,0,0,2,2]],       "expected": [[-2,0,2]],            "weight": 2},
    {"input": [[]],                 "expected": [],                    "weight": 2}
  ]'::jsonb,
  '["Sorting the array first makes it much easier to avoid duplicates and use directional pointer movement.", "After sorting, fix one element and reduce the problem to Two Sum on the remaining array using two pointers.", "Sort nums. For each index i (skip duplicates), set left = i+1 and right = n−1. While left < right, check the sum: if zero, record the triplet and skip duplicate left/right values; if negative, advance left; if positive, retreat right."]'::jsonb,
  30,
  ARRAY['arrays', 'two_pointers']
);

-- ─── MEDIUM 14 ───────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'product-of-array-except-self',
  'Product of Array Except Self',
  'medium',
  'any',
  $$Given an integer array `nums`, return an array `answer` such that `answer[i]` is equal to the product of all the elements of `nums` except `nums[i]`.

You must write an algorithm that runs in O(n) time and without using the division operation.

**Example 1:**
Input: `nums = [1,2,3,4]`
Output: `[24,12,8,6]`

**Example 2:**
Input: `nums = [-1,1,0,-3,3]`
Output: `[0,0,9,0,0]`

**Constraints:**
- 2 ≤ nums.length ≤ 10⁵
- -30 ≤ nums[i] ≤ 30
- The product of any prefix or suffix of nums is guaranteed to fit in a 32-bit integer.$$,
  '{"python": "def product_except_self(nums: list[int]) -> list[int]:\n    pass", "javascript": "function productExceptSelf(nums) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": [[1,2,3,4]],        "expected": [24,12,8,6],  "weight": 1},
    {"input": [[-1,1,0,-3,3]],    "expected": [0,0,9,0,0],  "weight": 2},
    {"input": [[1,1]],            "expected": [1,1],         "weight": 2},
    {"input": [[2,3,4,5]],        "expected": [60,40,30,24], "weight": 1},
    {"input": [[1,2,3,0,5]],      "expected": [0,0,0,30,0],  "weight": 2}
  ]'::jsonb,
  '["The product except self at position i is equal to the product of everything to the left of i multiplied by the product of everything to the right of i.", "Compute a prefix-product array (left pass) and a suffix-product array (right pass), then multiply them element-wise.", "First pass (left to right): build prefix[i] = product of nums[0..i-1]. Second pass (right to left): accumulate a running suffix product and multiply into the result. No division needed."]'::jsonb,
  30,
  ARRAY['arrays']
);

-- ─── MEDIUM 15 ───────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'top-k-frequent-elements',
  'Top K Frequent Elements',
  'medium',
  'any',
  $$Given an integer array `nums` and an integer `k`, return the `k` most frequent elements. Return the answer sorted in ascending order.

**Example 1:**
Input: `nums = [1,1,1,2,2,3]`, `k = 2`
Output: `[1,2]`

**Example 2:**
Input: `nums = [1]`, `k = 1`
Output: `[1]`

**Constraints:**
- 1 ≤ nums.length ≤ 10⁵
- -10⁴ ≤ nums[i] ≤ 10⁴
- k is in the range [1, the number of unique elements in the array].
- It is guaranteed that the answer is unique.$$,
  '{"python": "def top_k_frequent(nums: list[int], k: int) -> list[int]:\n    pass", "javascript": "function topKFrequent(nums, k) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": [[1,1,1,2,2,3], 2],      "expected": [1,2],   "weight": 1},
    {"input": [[1], 1],                "expected": [1],     "weight": 1},
    {"input": [[1,2], 2],              "expected": [1,2],   "weight": 2},
    {"input": [[4,1,2,1,2,3], 2],      "expected": [1,2],   "weight": 2},
    {"input": [[1,1,1,2,2,3], 1],      "expected": [1],     "weight": 2}
  ]'::jsonb,
  '["You need the k elements with the highest counts. Start by building a frequency map.", "Sorting by frequency is O(n log n). Bucket sort (frequency as index) achieves O(n) since no frequency exceeds n.", "Count frequencies in a hashmap. Use bucket sort: create buckets indexed 0..n where bucket[f] holds all elements with frequency f. Scan buckets from high to low, collecting k elements."]'::jsonb,
  30,
  ARRAY['arrays', 'hashmap']
);

-- ─── MEDIUM 16 ───────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'binary-tree-level-order-traversal',
  'Binary Tree Level Order Traversal',
  'medium',
  'any',
  $$Given the root of a binary tree (represented as a level-order array where `null` marks a missing node), return the level-order traversal of its nodes' values as a list of lists.

**Example 1:**
Input: `root = [3,9,20,null,null,15,7]`
Output: `[[3],[9,20],[15,7]]`

**Example 2:**
Input: `root = [1]`
Output: `[[1]]`

**Constraints:**
- The number of nodes in the tree is in the range [0, 2000].
- -1000 ≤ Node.val ≤ 1000
- The tree is given as a level-order array (null = missing node). The judge deserializes it into a TreeNode before calling your function.$$,
  '{"python": "def level_order(root) -> list[list[int]]:\n    # root is a TreeNode; build your BFS from here\n    pass", "javascript": "function levelOrder(root) {\n  // root is a TreeNode; build your BFS from here\n}"}'::jsonb,
  '[
    {"input": [[3,9,20,null,null,15,7]],  "expected": [[3],[9,20],[15,7]],  "weight": 1},
    {"input": [[1]],                      "expected": [[1]],                "weight": 1},
    {"input": [null],                     "expected": [],                   "weight": 2},
    {"input": [[1,2,3,4,5]],             "expected": [[1],[2,3],[4,5]],    "weight": 1},
    {"input": [[1,null,2,null,3]],        "expected": [[1],[2],[3]],        "weight": 2}
  ]'::jsonb,
  '["Level order traversal visits all nodes at depth d before any node at depth d+1 — which data structure processes elements in that order?", "A queue (FIFO) is the natural fit: enqueue the root, then repeatedly dequeue a node, record its value, and enqueue its children.", "Initialize a queue with the root. On each iteration, snapshot the queue size (that is the number of nodes on the current level), dequeue that many nodes recording their values, enqueue their non-null children, and append the level''s values to the result."]'::jsonb,
  30,
  ARRAY['bfs_dfs']
);

-- ─── MEDIUM 17 ───────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'number-of-islands',
  'Number of Islands',
  'medium',
  'any',
  $$Given an m × n 2D binary grid `grid` where `"1"` represents land and `"0"` represents water, return the number of islands.

An island is surrounded by water and is formed by connecting adjacent lands horizontally or vertically. You may assume all four edges of the grid are surrounded by water.

**Example 1:**
Input:
```
grid = [
  ["1","1","1","1","0"],
  ["1","1","0","1","0"],
  ["1","1","0","0","0"],
  ["0","0","0","0","0"]
]
```
Output: `1`

**Example 2:**
Input:
```
grid = [
  ["1","1","0","0","0"],
  ["1","1","0","0","0"],
  ["0","0","1","0","0"],
  ["0","0","0","1","1"]
]
```
Output: `3`

**Constraints:**
- m == grid.length, n == grid[i].length
- 1 ≤ m, n ≤ 300
- grid[i][j] is `"0"` or `"1"`.$$,
  '{"python": "def num_islands(grid: list[list[str]]) -> int:\n    pass", "javascript": "function numIslands(grid) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": [[["1","1","1","1","0"],["1","1","0","1","0"],["1","1","0","0","0"],["0","0","0","0","0"]]],  "expected": 1, "weight": 1},
    {"input": [[["1","1","0","0","0"],["1","1","0","0","0"],["0","0","1","0","0"],["0","0","0","1","1"]]],  "expected": 3, "weight": 1},
    {"input": [[["1"]]],                                                                                     "expected": 1, "weight": 2},
    {"input": [[["0"]]],                                                                                     "expected": 0, "weight": 2},
    {"input": [[["1","0","1"],["0","1","0"],["1","0","1"]]],                                               "expected": 5, "weight": 2}
  ]'::jsonb,
  '["When you find a land cell, you need to visit all land cells reachable from it — that is the definition of one island.", "BFS or DFS from any unvisited land cell will mark all cells in that island as visited (e.g., flip them to \"0\").", "For every cell (i,j): if grid[i][j] == \"1\", increment island count and run BFS/DFS to mark all connected land cells as \"0\" so they are not counted again."]'::jsonb,
  30,
  ARRAY['bfs_dfs']
);

-- ─── MEDIUM 18 ───────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'clone-graph',
  'Clone Graph',
  'medium',
  'any',
  $$Given a reference to a node in a connected undirected graph, return a deep copy (clone) of the graph.

The graph is represented as an adjacency list where `graph[i]` is the list of neighbors of node with value i+1. Nodes are numbered 1 to n. Return the cloned graph as an adjacency list in the same format.

**Example 1:**
Input: `adjList = [[2,4],[1,3],[2,4],[1,3]]`
Output: `[[2,4],[1,3],[2,4],[1,3]]`
Explanation: 4-node graph where node 1 connects to 2 and 4, etc.

**Example 2:**
Input: `adjList = [[]]`
Output: `[[]]`
Explanation: Single node with no neighbors.

**Constraints:**
- 0 ≤ n ≤ 100 (number of nodes)
- 1 ≤ Node.val ≤ 100
- The graph is connected and has no repeated edges or self-loops.$$,
  '{"python": "def clone_graph(adj_list: list[list[int]]) -> list[list[int]]:\n    pass", "javascript": "function cloneGraph(adjList) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": [[[2,4],[1,3],[2,4],[1,3]]],  "expected": [[2,4],[1,3],[2,4],[1,3]], "weight": 1},
    {"input": [[[]]],                        "expected": [[]],                      "weight": 2},
    {"input": [[[2],[1]]],                   "expected": [[2],[1]],                 "weight": 1},
    {"input": [[[2,3],[1,3],[1,2]]],         "expected": [[2,3],[1,3],[1,2]],       "weight": 2},
    {"input": [[[2],[1,3],[2]]],             "expected": [[2],[1,3],[2]],           "weight": 1}
  ]'::jsonb,
  '["If you clone nodes one by one without tracking which nodes you''ve already cloned, you''ll loop forever on a cycle.", "A hashmap from original node to its clone lets you detect already-cloned nodes and prevents infinite recursion.", "Use BFS or DFS. Maintain a visited map. When you first encounter a node, create its clone and add it to the map. Then for each neighbor, if already cloned use the existing clone; if not, clone it and recurse/enqueue."]'::jsonb,
  30,
  ARRAY['bfs_dfs']
);

-- ─── MEDIUM 19 ───────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'coin-change',
  'Coin Change',
  'medium',
  'any',
  $$You are given an integer array `coins` representing coins of different denominations and an integer `amount` representing a total amount of money.

Return the fewest number of coins that you need to make up that amount. If that amount of money cannot be made up by any combination of the coins, return `-1`.

You may assume that you have an infinite number of each kind of coin.

**Example 1:**
Input: `coins = [1,5,11]`, `amount = 15`
Output: `3`
Explanation: 5 + 5 + 5 = 15.

**Example 2:**
Input: `coins = [2]`, `amount = 3`
Output: `-1`

**Constraints:**
- 1 ≤ coins.length ≤ 12
- 1 ≤ coins[i] ≤ 2³¹ − 1
- 0 ≤ amount ≤ 10⁴$$,
  '{"python": "def coin_change(coins: list[int], amount: int) -> int:\n    pass", "javascript": "function coinChange(coins, amount) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": [[1,5,11], 15],   "expected": 3,  "weight": 1},
    {"input": [[2], 3],         "expected": -1, "weight": 1},
    {"input": [[1], 0],         "expected": 0,  "weight": 2},
    {"input": [[1,2,5], 11],    "expected": 3,  "weight": 1},
    {"input": [[1,2,5], 100],   "expected": 20, "weight": 2}
  ]'::jsonb,
  '["The problem has optimal substructure: the minimum coins to make amount X depends on the minimum coins to make X − coin for each coin denomination.", "Build a DP array dp[0..amount] where dp[a] = min coins to reach amount a. dp[0] = 0; all others start at infinity.", "For each amount a from 1 to amount, iterate over all coins: dp[a] = min(dp[a], 1 + dp[a − coin]) for each coin ≤ a. Return dp[amount] if it is not infinity, else −1."]'::jsonb,
  30,
  ARRAY['dp']
);

-- ─── MEDIUM 20 ───────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'house-robber',
  'House Robber',
  'medium',
  'any',
  $$You are a professional robber planning to rob houses along a street. Each house has a certain amount of money stashed. The only constraint stopping you from robbing each of them is that adjacent houses have security systems connected — if two adjacent houses are broken into on the same night, it will alert the police.

Given an integer array `nums` representing the amount of money in each house, return the maximum amount of money you can rob tonight without alerting the police.

**Example 1:**
Input: `nums = [1,2,3,1]`
Output: `4`
Explanation: Rob house 1 (money = 1) then house 3 (money = 3). Total = 4.

**Example 2:**
Input: `nums = [2,7,9,3,1]`
Output: `12`
Explanation: Rob house 1 (2) + house 3 (9) + house 5 (1) = 12.

**Constraints:**
- 1 ≤ nums.length ≤ 100
- 0 ≤ nums[i] ≤ 400$$,
  '{"python": "def house_robber(nums: list[int]) -> int:\n    pass", "javascript": "function rob(nums) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": [[1,2,3,1]],    "expected": 4,  "weight": 1},
    {"input": [[2,7,9,3,1]], "expected": 12, "weight": 1},
    {"input": [[1]],          "expected": 1,  "weight": 2},
    {"input": [[2,1]],        "expected": 2,  "weight": 2},
    {"input": [[0,0,0]],      "expected": 0,  "weight": 2}
  ]'::jsonb,
  '["At each house you make a choice: rob it (and skip the previous) or skip it (and keep whatever you had up through the previous house).", "This has the same structure as Fibonacci: the state at house i depends only on the states at houses i-1 and i-2.", "dp[i] = max(dp[i-1], dp[i-2] + nums[i]). You only need the last two values, so use two variables: prev2 and prev1. Update them as you walk the array."]'::jsonb,
  30,
  ARRAY['dp']
);

-- ─── MEDIUM 21 ───────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'validate-bst',
  'Validate Binary Search Tree',
  'medium',
  'any',
  $$Given the root of a binary tree (as a level-order array), determine if it is a valid binary search tree (BST).

A valid BST requires:
- The left subtree of a node contains only nodes with keys strictly less than the node's key.
- The right subtree of a node contains only nodes with keys strictly greater than the node's key.
- Both left and right subtrees must also be valid BSTs.

**Example 1:**
Input: `root = [2,1,3]`
Output: `true`

**Example 2:**
Input: `root = [5,1,4,null,null,3,6]`
Output: `false`
Explanation: The right child''s value (4) is not greater than the root (5).

**Constraints:**
- The number of nodes is in range [1, 10⁴].
- -2³¹ ≤ Node.val ≤ 2³¹ − 1
- The tree is given as a level-order array (null = missing node).$$,
  '{"python": "def is_valid_bst(root) -> bool:\n    # root is a TreeNode\n    pass", "javascript": "function isValidBST(root) {\n  // root is a TreeNode\n}"}'::jsonb,
  '[
    {"input": [[2,1,3]],                    "expected": true,  "weight": 1},
    {"input": [[5,1,4,null,null,3,6]],      "expected": false, "weight": 1},
    {"input": [[1]],                        "expected": true,  "weight": 2},
    {"input": [[2,2,2]],                    "expected": false, "weight": 2},
    {"input": [[5,4,6,null,null,3,7]],      "expected": false, "weight": 2}
  ]'::jsonb,
  '["Just checking that each node is greater than its left child and less than its right child is not sufficient — a node in the right subtree must be greater than all of its ancestors.", "Pass valid (min, max) bounds down the tree: every node''s value must lie strictly within those bounds.", "Recurse with validate(node, min_bound, max_bound). For the left child tighten the upper bound to node.val; for the right child tighten the lower bound to node.val. Return false the moment a node''s value violates its bounds."]'::jsonb,
  30,
  ARRAY['bfs_dfs', 'recursion']
);

-- ─── MEDIUM 22 ───────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'kth-largest-element',
  'Kth Largest Element in an Array',
  'medium',
  'any',
  $$Given an integer array `nums` and an integer `k`, return the k-th largest element in the array.

Note that it is the k-th largest element in sorted order, not the k-th distinct element.

**Example 1:**
Input: `nums = [3,2,1,5,6,4]`, `k = 2`
Output: `5`

**Example 2:**
Input: `nums = [3,2,3,1,2,4,5,5,6]`, `k = 4`
Output: `4`

**Constraints:**
- 1 ≤ k ≤ nums.length ≤ 10⁵
- -10⁴ ≤ nums[i] ≤ 10⁴$$,
  '{"python": "def find_kth_largest(nums: list[int], k: int) -> int:\n    pass", "javascript": "function findKthLargest(nums, k) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": [[3,2,1,5,6,4], 2],        "expected": 5,  "weight": 1},
    {"input": [[3,2,3,1,2,4,5,5,6], 4], "expected": 4,  "weight": 1},
    {"input": [[1], 1],                   "expected": 1,  "weight": 2},
    {"input": [[-1,-2,-3], 1],            "expected": -1, "weight": 2},
    {"input": [[2,1], 2],                 "expected": 1,  "weight": 2}
  ]'::jsonb,
  '["Sorting and indexing from the end works but costs O(n log n). Can you do better?", "A min-heap of size k always holds the k largest elements seen so far; its root is the kth largest.", "Use a min-heap of size k. Push each element; if the heap exceeds k elements, pop the smallest. After processing all elements the heap root is the answer. Alternatively, QuickSelect achieves O(n) average time."]'::jsonb,
  30,
  ARRAY['arrays']
);

-- ─── MEDIUM 23 ───────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'longest-palindromic-substring',
  'Longest Palindromic Substring',
  'medium',
  'any',
  $$Given a string `s`, return the longest palindromic substring in `s`.

**Example 1:**
Input: `s = "babad"`
Output: `"bab"`
(Note: `"aba"` is also a valid answer.)

**Example 2:**
Input: `s = "cbbd"`
Output: `"bb"`

**Constraints:**
- 1 ≤ s.length ≤ 1000
- s consists of only digits and English letters.$$,
  '{"python": "def longest_palindrome(s: str) -> str:\n    pass", "javascript": "function longestPalindrome(s) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": ["babad"],    "expected": "bab",     "weight": 1},
    {"input": ["cbbd"],     "expected": "bb",      "weight": 1},
    {"input": ["a"],        "expected": "a",       "weight": 2},
    {"input": ["racecar"],  "expected": "racecar", "weight": 2},
    {"input": ["abacaba"],  "expected": "abacaba", "weight": 2}
  ]'::jsonb,
  '["A palindrome is symmetric around its center. There are 2n − 1 possible centers (each character, and each gap between characters).", "Expand Around Center: for each center, expand outward as long as characters match. This is O(n²) time and O(1) space.", "Iterate over each center (both odd-length and even-length cases). Expand while s[left] == s[right]. Track the start and length of the longest palindrome found."]'::jsonb,
  30,
  ARRAY['strings']
);

-- ─── MEDIUM 24 ───────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'min-stack',
  'Min Stack',
  'medium',
  'any',
  $$Design a stack that supports push, pop, top, and retrieving the minimum element in constant time.

Implement the `MinStack` class:
- `MinStack()` — initializes the stack object.
- `void push(int val)` — pushes the element val onto the stack.
- `void pop()` — removes the element on the top of the stack.
- `int top()` — gets the top element of the stack.
- `int getMin()` — retrieves the minimum element in the stack.

Each function must run in O(1) time.

**Example 1:**
Input: `["MinStack","push","push","push","getMin","pop","top","getMin"]`, args: `[[],[-2],[0],[-3],[],[],[],[]]`
Output: `[null,null,null,null,-3,null,0,-2]`

**Example 2:**
Input: `["MinStack","push","push","getMin","pop","getMin"]`, args: `[[],[5],[3],[],[],[]]`
Output: `[null,null,null,3,null,5]`

**Constraints:**
- -2³¹ ≤ val ≤ 2³¹ − 1
- pop, top and getMin operations will always be called on non-empty stacks.
- At most 3 × 10⁴ calls will be made to push, pop, top, and getMin.$$,
  '{"python": "class MinStack:\n    def __init__(self):\n        pass\n    def push(self, val: int) -> None:\n        pass\n    def pop(self) -> None:\n        pass\n    def top(self) -> int:\n        pass\n    def getMin(self) -> int:\n        pass", "javascript": "class MinStack {\n  constructor() {}\n  push(val) {}\n  pop() {}\n  top() {}\n  getMin() {}\n}"}'::jsonb,
  '[
    {"input": [["MinStack","push","push","push","getMin","pop","top","getMin"], [[],[-2],[0],[-3],[],[],[],[]]], "expected": [null,null,null,null,-3,null,0,-2], "weight": 1},
    {"input": [["MinStack","push","push","getMin","pop","getMin"], [[],[5],[3],[],[],[]]], "expected": [null,null,null,3,null,5], "weight": 1},
    {"input": [["MinStack","push","getMin"], [[],[1],[]]], "expected": [null,null,1], "weight": 2},
    {"input": [["MinStack","push","push","push","getMin"], [[],[1],[2],[3],[]]], "expected": [null,null,null,null,1], "weight": 2},
    {"input": [["MinStack","push","push","push","getMin","pop","getMin"], [[],[3],[2],[1],[],[],[]]], "expected": [null,null,null,null,1,null,2], "weight": 2}
  ]'::jsonb,
  '["A regular stack can''t answer getMin in O(1) after a pop, because the previous minimum could have been the element that was just removed.", "Maintain a second \"min stack\" in parallel. Push onto it whenever the new value is ≤ the current min; pop from it whenever you pop a value equal to the current min.", "Each stack node stores (value, current_min_at_this_point). On push, record min(val, top_min). On getMin, just read the min field of the top node — no extra stack needed."]'::jsonb,
  30,
  ARRAY['stack_queue']
);

-- ─── MEDIUM 25 ───────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'evaluate-reverse-polish-notation',
  'Evaluate Reverse Polish Notation',
  'medium',
  'any',
  $$Evaluate the value of an arithmetic expression in Reverse Polish Notation.

Valid operators are `+`, `-`, `*`, and `/`. Each operand may be an integer or another expression. Division between two integers always truncates toward zero.

There will not be any division by zero. The input represents a valid arithmetic expression in RPN.

**Example 1:**
Input: `tokens = ["2","1","+","3","*"]`
Output: `9`
Explanation: ((2 + 1) * 3) = 9

**Example 2:**
Input: `tokens = ["4","13","5","/","+"]`
Output: `6`
Explanation: (4 + (13 / 5)) = 6

**Constraints:**
- 1 ≤ tokens.length ≤ 10⁴
- tokens[i] is either an operator (+, -, *, /) or an integer in the range [-200, 200].$$,
  '{"python": "def eval_rpn(tokens: list[str]) -> int:\n    pass", "javascript": "function evalRPN(tokens) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": [["2","1","+","3","*"]],                                         "expected": 9,  "weight": 1},
    {"input": [["4","13","5","/","+"]],                                        "expected": 6,  "weight": 1},
    {"input": [["10","6","9","3","+","-11","*","/","*","17","+","5","+"]],    "expected": 22, "weight": 2},
    {"input": [["3"]],                                                          "expected": 3,  "weight": 2},
    {"input": [["2","1","-"]],                                                 "expected": 1,  "weight": 1}
  ]'::jsonb,
  '["In RPN, an operator always applies to the two most recently seen numbers — that is a last-in-first-out pattern.", "A stack is the natural fit: push numbers, and when you hit an operator pop two operands, apply the operator, and push the result.", "Iterate over tokens. If a token is a number push it. If it is an operator, pop b then a, compute a op b (note the order!), and push the result. The final answer is the single remaining item on the stack."]'::jsonb,
  30,
  ARRAY['stack_queue']
);

-- ─── HARD 26 ─────────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'merge-k-sorted-lists',
  'Merge K Sorted Lists',
  'hard',
  'any',
  $$You are given an array of `k` sorted integer arrays `lists` (each representing a sorted linked list). Merge all the lists into one sorted array and return it.

**Example 1:**
Input: `lists = [[1,4,5],[1,3,4],[2,6]]`
Output: `[1,1,2,3,4,4,5,6]`

**Example 2:**
Input: `lists = [[]]`
Output: `[]`

**Constraints:**
- k == lists.length
- 0 ≤ k ≤ 10⁴
- 0 ≤ lists[i].length ≤ 500
- -10⁴ ≤ lists[i][j] ≤ 10⁴
- Each lists[i] is sorted in ascending order.$$,
  '{"python": "def merge_k_lists(lists: list[list[int]]) -> list[int]:\n    pass", "javascript": "function mergeKLists(lists) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": [[[1,4,5],[1,3,4],[2,6]]],     "expected": [1,1,2,3,4,4,5,6], "weight": 1},
    {"input": [[[]]],                         "expected": [],                 "weight": 2},
    {"input": [[]],                           "expected": [],                 "weight": 2},
    {"input": [[[1,2],[3,4],[5,6]]],          "expected": [1,2,3,4,5,6],     "weight": 1},
    {"input": [[[-1,0,1],[-2,2]]],            "expected": [-2,-1,0,1,2],     "weight": 2}
  ]'::jsonb,
  '["Merging all lists naively by repeatedly scanning all k heads is O(nk) total. Think about how you can always find the smallest current head faster.", "A min-heap of size k stores one element (with its list index and position) per list, letting you extract the global minimum in O(log k).", "Initialize the heap with the first element of each non-empty list. While the heap is non-empty, extract the minimum, append it to the result, and push the next element from the same list (if any). Total time: O(n log k)."]'::jsonb,
  45,
  ARRAY['linked_list']
);

-- ─── HARD 27 ─────────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'trapping-rain-water',
  'Trapping Rain Water',
  'hard',
  'any',
  $$Given `n` non-negative integers representing an elevation map where the width of each bar is 1, compute how much water it can trap after raining.

**Example 1:**
Input: `height = [0,1,0,2,1,0,1,3,2,1,2,1]`
Output: `6`

**Example 2:**
Input: `height = [4,2,0,3,2,5]`
Output: `9`

**Constraints:**
- n == height.length
- 1 ≤ n ≤ 2 × 10⁴
- 0 ≤ height[i] ≤ 10⁵$$,
  '{"python": "def trap(height: list[int]) -> int:\n    pass", "javascript": "function trap(height) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": [[0,1,0,2,1,0,1,3,2,1,2,1]],  "expected": 6, "weight": 1},
    {"input": [[4,2,0,3,2,5]],              "expected": 9, "weight": 1},
    {"input": [[1]],                         "expected": 0, "weight": 2},
    {"input": [[3,0,3]],                     "expected": 3, "weight": 2},
    {"input": [[3,0,0,0,3]],                 "expected": 9, "weight": 2}
  ]'::jsonb,
  '["The water above any bar is limited by the shorter of the tallest bar to its left and the tallest bar to its right.", "Precompute left_max[i] and right_max[i] arrays. Water at position i = min(left_max[i], right_max[i]) − height[i].", "Two-pointer approach avoids the extra arrays: maintain left_max and right_max as you converge. Process the side with the smaller max first — water there is fully determined, so advance that pointer."]'::jsonb,
  45,
  ARRAY['arrays', 'two_pointers']
);

-- ─── HARD 28 ─────────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'word-ladder',
  'Word Ladder',
  'hard',
  'any',
  $$A transformation sequence from word `beginWord` to word `endWord` using a dictionary `wordList` is a sequence `beginWord -> s1 -> s2 -> ... -> sk` such that:

- Every adjacent pair of words differs by a single letter.
- Every si for 1 ≤ i ≤ k is in wordList.
- sk == endWord.

Given `beginWord`, `endWord`, and `wordList`, return the number of words in the shortest transformation sequence from `beginWord` to `endWord`, or `0` if no such sequence exists.

**Example 1:**
Input: `beginWord = "hit"`, `endWord = "cog"`, `wordList = ["hot","dot","dog","lot","log","cog"]`
Output: `5`
Explanation: hit → hot → dot → dog → cog

**Example 2:**
Input: `beginWord = "hit"`, `endWord = "cog"`, `wordList = ["hot","dot","dog","lot","log"]`
Output: `0`
Explanation: endWord "cog" is not in wordList.

**Constraints:**
- 1 ≤ beginWord.length ≤ 10
- endWord.length == beginWord.length
- 1 ≤ wordList.length ≤ 5000
- All words have the same length and consist of lowercase English letters.$$,
  '{"python": "def ladder_length(begin_word: str, end_word: str, word_list: list[str]) -> int:\n    pass", "javascript": "function ladderLength(beginWord, endWord, wordList) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": ["hit", "cog", ["hot","dot","dog","lot","log","cog"]],  "expected": 5, "weight": 1},
    {"input": ["hit", "cog", ["hot","dot","dog","lot","log"]],        "expected": 0, "weight": 1},
    {"input": ["a",   "b",   ["b"]],                                   "expected": 2, "weight": 2},
    {"input": ["hot", "dog", ["hot","dog","dot"]],                     "expected": 3, "weight": 2},
    {"input": ["ab",  "cd",  ["ac","bc","bd","cd"]],                   "expected": 5, "weight": 2}
  ]'::jsonb,
  '["This is a shortest-path problem on a graph where each word is a node and edges connect words that differ by exactly one letter.", "BFS from beginWord finds the shortest path (fewest transformations) because it explores all words at distance d before any at distance d+1.", "Use BFS. At each level, for each word generate all single-letter mutations and check if they are in the word set. Remove a word from the set once it is visited to avoid revisiting. Return the level count when endWord is reached."]'::jsonb,
  45,
  ARRAY['bfs_dfs']
);

-- ─── HARD 29 ─────────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'serialize-deserialize-binary-tree',
  'Serialize and Deserialize Binary Tree',
  'hard',
  'any',
  $$Design an algorithm to serialize and deserialize a binary tree. Serialization converts a tree to a string; deserialization converts that string back to a tree.

There is no restriction on your serialization format. The tree is given as a level-order array (null = missing node). Your implementation must guarantee that deserialize(serialize(tree)) reproduces the original tree, verified by comparing the resulting level-order array.

**Example 1:**
Input: `root = [1,2,3,null,null,4,5]`
Output (round-trip): `[1,2,3,null,null,4,5]`

**Example 2:**
Input: `root = []` (empty tree)
Output: `[]`

**Constraints:**
- The number of nodes is in range [0, 10⁴].
- -1000 ≤ Node.val ≤ 1000
- The tree is given as a level-order array. The judge builds the tree, calls serialize, calls deserialize, and compares the resulting tree level-order traversal.$$,
  '{"python": "class Codec:\n    def serialize(self, root) -> str:\n        pass\n    def deserialize(self, data: str):\n        pass", "javascript": "class Codec {\n  serialize(root) {}\n  deserialize(data) {}\n}"}'::jsonb,
  '[
    {"input": [[1,2,3,null,null,4,5]],       "expected": [1,2,3,null,null,4,5], "weight": 1},
    {"input": [null],                         "expected": [],                    "weight": 2},
    {"input": [[1]],                          "expected": [1],                   "weight": 2},
    {"input": [[1,2,null,3,null,4]],          "expected": [1,2,null,3,null,4],   "weight": 2},
    {"input": [[5,4,7,3,null,2,null,-1,null,9]], "expected": [5,4,7,3,null,2,null,-1,null,9], "weight": 2}
  ]'::jsonb,
  '["You need a format that can represent missing subtrees unambiguously — a plain array without null markers can''t distinguish a leaf from an internal node with missing children.", "BFS (level-order) serialization with explicit null markers for missing children is simple and fully reversible.", "Serialize: BFS traversal, append each node''s value (or a sentinel like \"null\") to a string. Deserialize: split the string, use a queue to rebuild — the i-th pair of non-null tokens in the queue are the left and right children of the current node."]'::jsonb,
  45,
  ARRAY['bfs_dfs', 'recursion']
);

-- ─── HARD 30 ─────────────────────────────────────────────────
INSERT INTO coding_problems (slug, title, difficulty, language, prompt, function_signature, hidden_tests, hints, target_minutes, tags) VALUES
(
  'longest-increasing-path-in-matrix',
  'Longest Increasing Path in a Matrix',
  'hard',
  'any',
  $$Given an m × n integer matrix, return the length of the longest increasing path.

From each cell, you can move in four directions: left, right, up, or down. You may not move diagonally or move outside the boundary.

**Example 1:**
Input: `matrix = [[9,9,4],[6,6,8],[2,1,1]]`
Output: `4`
Explanation: The longest increasing path is `[1,2,6,9]`.

**Example 2:**
Input: `matrix = [[3,4,5],[3,2,6],[2,2,1]]`
Output: `4`
Explanation: The longest path is `[2,4,5,6]`.

**Constraints:**
- m == matrix.length, n == matrix[0].length
- 1 ≤ m, n ≤ 200
- 0 ≤ matrix[i][j] ≤ 2³¹ − 1$$,
  '{"python": "def longest_increasing_path(matrix: list[list[int]]) -> int:\n    pass", "javascript": "function longestIncreasingPath(matrix) {\n  // your code here\n}"}'::jsonb,
  '[
    {"input": [[[9,9,4],[6,6,8],[2,1,1]]],             "expected": 4, "weight": 1},
    {"input": [[[3,4,5],[3,2,6],[2,2,1]]],             "expected": 4, "weight": 1},
    {"input": [[[1]]],                                  "expected": 1, "weight": 2},
    {"input": [[[1,2],[3,4]]],                          "expected": 3, "weight": 2},
    {"input": [[[1,2,3,4],[5,6,7,8],[9,10,11,12]]],    "expected": 6, "weight": 2}
  ]'::jsonb,
  '["This is a DFS on the matrix where you can only move to strictly larger neighbors. Because values are strictly increasing, there are no cycles, so DFS is safe.", "Memoize the result of each cell: once you''ve computed the longest increasing path starting at (i,j), cache it so you don''t recompute.", "DFS + memo: for each cell (i,j), result = 1 + max(DFS(neighbor)) over all four neighbors with a strictly greater value. Cache results in a 2D array. Return the global maximum."]'::jsonb,
  45,
  ARRAY['bfs_dfs', 'dp']
);
