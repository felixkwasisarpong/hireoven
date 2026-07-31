// Keep /jobs crawlable instead of emitting a temporary redirect. The rendered
// page keeps /jobs/browse as its canonical URL, so old links consolidate there.
export { metadata, default } from "./browse/page"
