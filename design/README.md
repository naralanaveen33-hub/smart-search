# SwiftSearch — UI Reference

`swiftsearch-ui-mockups.png` — full mockup set, dark theme (top half) and light theme (bottom half).

## Brand
- Product: **SwiftSearch** — "Smart Search. Lightning Fast."
- Engine: BSBI (Blocked Sort-Based Indexing) inverted index
- Accent: violet/indigo (`#6D5AE6`-ish), rounded cards, soft borders, subtle shadows
- Dark bg: near-black navy panels; Light bg: white cards on light gray

## Screens

| # | Screen | Key elements |
|---|--------|--------------|
| 1 | Home | Left sidebar nav (Home, How It Works, Documents, Indexing, Search, Index Explorer, Analytics, Settings), hero + CTA "Get Started" / "How It Works", dark/light toggle, 4 stat tiles (12,483 Documents · 68,920 Unique Terms · 128 MB Index Size · 23,456 Searches) |
| 2 | How It Works | 6-step vertical list (Documents → Tokenization → Block Creation → Sorting → Merging → Final Index) + right detail pane with example, Prev/Next pager with dots |
| 3 | Upload Documents | Drag & drop zone (.txt, .pdf, .docx, .md), file table (name/size/status), "Start Indexing" primary button |
| 4 | Indexing (Live Process) | 6-stage checklist with completed/in-progress/waiting states + progress bar, "Live Stats" panel (docs processed, tokens generated, blocks created, current block, memory used, elapsed time), bottom summary strip |
| 4a | Step Detail (Block Creation) | Modal "Step 3 of 6": Tokens Stream (live), Current Memory (Block) term→docID table, Blocks on Disk cards (sorted/writing states), memory usage bar, tabs: Current Block / Blocks on Disk / Raw Tokens / Document Preview |
| 5 | Search | Query input + search button, Search Mode radios (All / AND / OR / Phrase), Popular Searches chips, Recent Searches list with timestamps |
| 6 | Results | Result count + time, Sort by dropdown, result cards with match % badge, highlighted snippets, file · page meta, BM25 score, Load More |
| 7 | Index Explorer | Term search, term stats (Document Frequency, Total Occurrences, Postings List size), tabs Postings / Term Statistics / Document Frequency, postings table (Document ID → Positions), pagination |
| 8 | Analytics | Date range picker, 5 KPI tiles with deltas, "Documents Indexed Over Time" line chart (This Month vs Last Month), "Top Query Categories" donut with legend, bottom metrics strip |
| 9 | Settings | Indexing Settings (Block Size, Maximum Memory, Language, Stop Words, Stemming), Search Settings (BM25, Case Sensitive, Phrase Search, Highlight Results), Results Per Page — selects + toggles |
| 10 | Presentation Mode | Auto-play demo of BSBI process, big play button, step icon strip with arrows, caption ("Document Ingestion — Raw documents are uploaded into the system."), 1/9 progress bar, Exit button |

## Notes
- Both themes must be supported; theme toggle lives in the sidebar footer.
- Numbers in mockups are sample data.
