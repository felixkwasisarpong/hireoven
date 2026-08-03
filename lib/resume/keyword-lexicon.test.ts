import test from "node:test"
import assert from "node:assert/strict"
import {
  canonicalizeLexiconTerm,
  extractJdTechTerms,
  matchEntryInText,
  lexiconEntryFor,
  matchTermInText,
} from "@/lib/resume/keyword-lexicon"

test("matchTermInText is boundary-aware (no substring false positives)", () => {
  assert.equal(matchTermInText("RAG", "We use RAG pipelines"), true)
  assert.equal(matchTermInText("RAG", "object storage layer"), false)
  assert.equal(matchTermInText("Go", "built the service in Go"), true)
  assert.equal(matchTermInText("Go", "we are going to ship"), false)
})

test("matchTermInText handles technology punctuation", () => {
  assert.equal(matchTermInText("Next.js", "built with Next.js"), true)
  assert.equal(matchTermInText("CI/CD", "owns the CI/CD pipeline"), true)
  assert.equal(matchTermInText("C++", "wrote C++ modules"), true)
  assert.equal(matchTermInText("C#", "services in C# and .NET"), true)
})

test("matchEntryInText matches via aliases in both directions", () => {
  const k8s = lexiconEntryFor("Kubernetes")!
  assert.equal(matchEntryInText(k8s, "deployed to k8s clusters"), true)
  const pg = lexiconEntryFor("PostgreSQL")!
  assert.equal(matchEntryInText(pg, "stored in postgres"), true)
  const claude = lexiconEntryFor("Anthropic Claude")!
  assert.equal(matchEntryInText(claude, "used Claude for summarization"), true)
  const azoai = lexiconEntryFor("Azure OpenAI")!
  assert.equal(matchEntryInText(azoai, "private Azure OpenAI Service instance"), true)
})

test("canonicalizeLexiconTerm collapses variants", () => {
  assert.equal(canonicalizeLexiconTerm("postgres"), "PostgreSQL")
  assert.equal(canonicalizeLexiconTerm("k8s"), "Kubernetes")
  assert.equal(canonicalizeLexiconTerm("retrieval augmented generation"), "RAG")
  assert.equal(canonicalizeLexiconTerm("gen ai"), "Generative AI")
  assert.equal(canonicalizeLexiconTerm("not-a-real-tool"), null)
})

test("extractJdTechTerms surfaces the modern GenAI/cloud/data stack the old canon missed", () => {
  const jd = `Seeking an AI Engineer to deploy production GenAI applications.
Architect prototype agents using Azure OpenAI, Anthropic Claude, and open-source LLMs.
Implement RAG systems, multi-agent orchestration using LangChain, LlamaIndex, or LangGraph.
Build API services (FastAPI) integrating with Snowflake data on Azure Databricks.
Deploy on Azure infrastructure with CI/CD pipelines and MLOps workflows.
Prior work with vector search (FAISS, Weaviate, Pinecone).`
  const terms = extractJdTechTerms(jd)
  const expected = [
    "Azure OpenAI",
    "Anthropic Claude",
    "RAG",
    "LangChain",
    "LlamaIndex",
    "LangGraph",
    "FastAPI",
    "Snowflake",
    "Databricks",
    "MLOps",
    "FAISS",
    "Weaviate",
    "Pinecone",
    "Multi-agent Orchestration",
  ]
  for (const term of expected) {
    assert.ok(terms.includes(term), `expected JD terms to include "${term}", got: ${terms.join(", ")}`)
  }
})
