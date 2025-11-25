# Agentic Paper Reviewer

An AI-powered paper review system integrated into Overleaf, designed specifically for **finance and economics research papers**.

## Overview

The Agentic Reviewer provides rapid feedback to researchers on their work, helping them iterate and improve their research faster. Instead of waiting months for peer review feedback, you can get instant AI-generated reviews grounded in relevant prior work.

### Key Features

- **PDF to Markdown Conversion**: Automatic extraction of paper content
- **Intelligent Search**: Finds related work from your local paper collection
- **7-Dimension Scoring**: Evaluates papers on originality, research question, claims support, experiments, clarity, community value, and prior work context
- **Finance/Economics Focus**: Specialized evaluation criteria for:
  - Methodological rigor (econometrics, identification strategy)
  - Data quality
  - Theoretical foundation
  - Policy relevance
- **Actionable Feedback**: Specific recommendations for improvement

## Setup

### 1. Environment Variables

Set the following environment variables:

```bash
# Required: LLM API Key
export OPENAI_API_KEY=your-openai-api-key

# Or use alternative providers:
# export AGENTIC_LLM_PROVIDER=anthropic
# export ANTHROPIC_API_KEY=your-anthropic-key

# Optional: Papers directory (default: /var/lib/overleaf/papers)
export AGENTIC_PAPERS_DIR=/path/to/your/papers

# Optional: PDF conversion API (for better PDF extraction)
# export AGENTIC_PDF_API_URL=https://api.landingai.com/v1/document/extract
# export AGENTIC_PDF_API_KEY=your-landing-ai-key
```

### 2. Papers Directory

Create a directory for your reference papers:

```bash
mkdir -p /var/lib/overleaf/papers
```

Organize papers by topic (optional):

```
/var/lib/overleaf/papers/
├── asset_pricing/
│   ├── fama_french_1993.pdf
│   └── carhart_1997.pdf
├── market_microstructure/
│   ├── kyle_1985.pdf
│   └── glosten_milgrom_1985.pdf
├── corporate_finance/
│   ├── modigliani_miller_1958.pdf
│   └── jensen_meckling_1976.pdf
└── macroeconomics/
    ├── taylor_1993.pdf
    └── clarida_gali_gertler_1999.pdf
```

### 3. Docker Compose Configuration

Add these environment variables to your `docker-compose.yml`:

```yaml
services:
  sharelatex:
    environment:
      # ... existing env vars ...
      
      # Agentic Reviewer Configuration
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      AGENTIC_PAPERS_DIR: /var/lib/overleaf/papers
      
    volumes:
      # ... existing volumes ...
      - ./papers:/var/lib/overleaf/papers
```

## Usage

### Via Web Interface

1. Navigate to `/agentic-reviewer` in your Overleaf instance
2. Enter the path to your PDF file or select from local papers
3. Choose a target venue (Finance Journal, Economics Journal, etc.)
4. Click "Submit for Review"
5. Wait for the review to complete (typically 1-3 minutes)
6. View the comprehensive review with scores and feedback

### Via API

```bash
# Submit a paper for review
curl -X POST http://localhost/api/agentic-reviewer/submit \
  -H "Content-Type: application/json" \
  -d '{
    "paperPath": "/var/lib/overleaf/papers/my_paper.pdf",
    "targetVenue": "finance"
  }'

# Check review status
curl http://localhost/api/agentic-reviewer/status/{reviewId}

# Get review result
curl http://localhost/api/agentic-reviewer/result/{reviewId}

# List local papers
curl http://localhost/api/agentic-reviewer/local-papers
```

## Review Dimensions

The reviewer evaluates papers on 7 dimensions (1-10 scale):

| Dimension | Weight | Description |
|-----------|--------|-------------|
| Originality | 18% | Novel contribution to the field |
| Research Question | 15% | Importance and relevance of the question |
| Claims Supported | 15% | Evidence supporting key claims |
| Experiments/Analysis | 14% | Soundness of empirical methodology |
| Clarity | 12% | Quality of writing and presentation |
| Community Value | 13% | Contribution to the research community |
| Prior Work Context | 13% | Appropriate citation and positioning |

### Finance/Economics Specific Criteria

The reviewer also evaluates:

1. **Methodological Rigor**
   - Econometric methods appropriately applied
   - Causal identification addressed
   - Standard errors correctly computed
   - Endogeneity handled

2. **Data Quality**
   - Data source description
   - Sample selection transparency
   - Survivorship bias consideration
   - Limitations acknowledged

3. **Theoretical Foundation**
   - Well-established framework
   - Assumptions explicitly stated
   - Model well-specified
   - Theory-empirics connection

4. **Policy Relevance**
   - Implications clearly articulated
   - External validity discussed
   - Welfare implications considered
   - Practical applicability

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Agentic Reviewer                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │ Controller  │───▶│   Service   │───▶│     LLM     │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│         │                  │                   │            │
│         │                  │                   │            │
│         ▼                  ▼                   ▼            │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Router    │    │Paper Source │    │PDF to MD    │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│                            │                               │
│                            ▼                               │
│                    ┌─────────────┐                         │
│                    │Local Papers │                         │
│                    │  Directory  │                         │
│                    └─────────────┘                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Extending the Paper Source

The `PaperSourceService` is designed to be modular. To add new paper sources:

```javascript
// In PaperSourceService.mjs, add new source type
const SOURCE_TYPES = {
  LOCAL: 'local',
  ARXIV: 'arxiv',     // Future: arXiv API
  SSRN: 'ssrn',       // Future: SSRN API
  REPEC: 'repec',     // Future: RePEc API
  CUSTOM: 'custom',
}

// Implement a new source function
async function searchArxiv({ queries, category = 'q-fin' }) {
  // Implement arXiv API search
  // See: https://arxiv.org/help/api
}
```

## Limitations

- **AI-Generated Reviews**: May contain errors and should not replace human peer review
- **Domain Specificity**: Optimized for finance/economics papers; accuracy may vary for other fields
- **Local Papers Only**: Currently searches only local paper directory; arXiv integration planned
- **PDF Quality**: Review quality depends on PDF extraction accuracy

## Troubleshooting

### "pdftotext not found"

Install poppler-utils:

```bash
# Ubuntu/Debian
apt-get install poppler-utils

# macOS
brew install poppler
```

### "LLM API key not configured"

Set the `OPENAI_API_KEY` environment variable or configure an alternative provider.

### "No papers found"

1. Check that the papers directory exists
2. Verify PDF files are present
3. Check file permissions

## License

Part of the Overleaf project. See main LICENSE file.
