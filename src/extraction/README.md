# Extraction and retrieval — Oriol + Albert

**Two stages. Do not conflate them.**

1. **Extraction** from the uploaded document. Parse to text (PDF/DOCX/MD/TXT). One LLM call returns
   operational commitments with any numbers the document states, **plus a span quote for each** so
   the user can see where it came from. Constrained JSON. Numbers found here → `documented`.
2. **Retrieval** to fill gaps. RAG over `corpus/` supplies a value and range for anything the
   document does not pin down → `literature`. Remaining gaps default to baseline → `assumed`,
   shown in amber.

Constrained JSON decoding against the `Params` schema; clamp to physical bounds.

**Fallback:** if extraction is weak on the day, pre-extract two documents and ship the parameter
sets in the precomputed bundle. The upload gesture still happens on stage. Declare it if asked.
