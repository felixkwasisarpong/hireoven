import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  commentToPost,
  extractApplyUrls,
  fetchWhoIsHiringPosts,
  flattenComments,
  parseCompanyName,
  pickLatestHiringStoryId,
  stripTags,
} from "./hn-whoishiring"

test("stripTags removes markup and unescapes entities", () => {
  assert.equal(stripTags("<p>Acme &amp; Co</p>"), "Acme & Co")
})

test("extractApplyUrls keeps only adapter-recognised URLs and unescapes hrefs", () => {
  const html =
    '<a href="https://boards.greenhouse.io/acme?gh_jid=1&amp;t=2">apply</a> ' +
    "see also https://example.com/careers and https://jobs.lever.co/acme"
  const urls = extractApplyUrls(html)
  assert.ok(urls.includes("https://boards.greenhouse.io/acme?gh_jid=1&t=2"))
  assert.ok(urls.includes("https://jobs.lever.co/acme"))
  assert.ok(!urls.some((u) => u.includes("example.com")))
})

test("parseCompanyName takes the text before the first pipe", () => {
  assert.equal(
    parseCompanyName("<p>Acme Robotics | Senior Engineer | Remote | apply: x</p>"),
    "Acme Robotics"
  )
  // no pipe -> first line/sentence, capped
  assert.equal(parseCompanyName("<p>Globex is hiring backend engineers</p>"), "Globex is hiring backend engineers")
})

test("commentToPost returns null without an adapter-matched URL", () => {
  assert.equal(commentToPost({ id: 1, text: "<p>Acme | role | https://example.com</p>" }), null)
  const post = commentToPost({
    id: 2,
    text: "<p>Acme | role | <a href=\"https://jobs.ashbyhq.com/acme\">apply</a></p>",
  })
  assert.ok(post)
  assert.equal(post!.companyName, "Acme")
  assert.deepEqual(post!.applyUrls, ["https://jobs.ashbyhq.com/acme"])
})

test("pickLatestHiringStoryId prefers a title match", () => {
  assert.equal(
    pickLatestHiringStoryId({
      hits: [
        { objectID: "1", title: "Random story" },
        { objectID: "2", title: "Ask HN: Who is hiring? (June 2026)" },
      ],
    }),
    "2"
  )
})

test("flattenComments walks the nested tree", () => {
  const flat = flattenComments({
    id: 0,
    children: [
      { id: 1, text: "a", children: [{ id: 2, text: "b" }] },
      { id: 3, text: "c" },
    ],
  })
  assert.deepEqual(flat.map((c) => c.id), [1, 2, 3])
})

test("fetchWhoIsHiringPosts resolves story then parses comments", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url
    if (url.includes("/search_by_date")) {
      return new Response(
        JSON.stringify({ hits: [{ objectID: "999", title: "Ask HN: Who is hiring?" }] })
      )
    }
    // items endpoint
    return new Response(
      JSON.stringify({
        id: 999,
        children: [
          {
            id: 11,
            text: 'Acme | Eng | <a href="https://jobs.lever.co/acme">apply</a>',
          },
          { id: 12, text: "No links here" },
        ],
      })
    )
  }

  const { storyId, posts } = await fetchWhoIsHiringPosts({ fetchImpl })
  assert.equal(storyId, "999")
  assert.equal(posts.length, 1)
  assert.equal(posts[0]!.companyName, "Acme")
  assert.deepEqual(posts[0]!.applyUrls, ["https://jobs.lever.co/acme"])
})
