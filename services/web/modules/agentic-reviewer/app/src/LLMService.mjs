import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'

/**
 * LLM Service
 * 
 * Handles all LLM interactions for the agentic reviewer.
 * 
 * Supports multiple LLM providers:
 * - OpenAI (GPT-4, GPT-3.5)
 * - Anthropic (Claude)
 * - Local models via Ollama
 * - Azure OpenAI
 * 
 * All prompts are optimized for finance and economics paper review.
 */

// Default model configuration
const DEFAULT_MODEL = 'gpt-4'
const DEFAULT_TEMPERATURE = 0.3
const DEFAULT_MAX_TOKENS = 4000

/**
 * Get LLM configuration from settings
 */
function getLLMConfig() {
  return {
    provider: Settings.agenticReviewer?.llmProvider || 'openai',
    model: Settings.agenticReviewer?.llmModel || DEFAULT_MODEL,
    apiKey: Settings.agenticReviewer?.llmApiKey || process.env.OPENAI_API_KEY,
    apiUrl: Settings.agenticReviewer?.llmApiUrl,
    temperature: Settings.agenticReviewer?.llmTemperature || DEFAULT_TEMPERATURE,
    maxTokens: Settings.agenticReviewer?.llmMaxTokens || DEFAULT_MAX_TOKENS,
  }
}

/**
 * Make LLM API call
 */
async function callLLM(prompt, options = {}) {
  const config = getLLMConfig()

  if (!config.apiKey) {
    logger.warn({}, 'LLM API key not configured, returning mock response')
    return getMockResponse(prompt)
  }

  const model = options.model || config.model
  const temperature = options.temperature ?? config.temperature
  const maxTokens = options.maxTokens || config.maxTokens

  try {
    switch (config.provider) {
      case 'openai':
        return await callOpenAI(prompt, { model, temperature, maxTokens, apiKey: config.apiKey })
      case 'anthropic':
        return await callAnthropic(prompt, { model, temperature, maxTokens, apiKey: config.apiKey })
      case 'ollama':
        return await callOllama(prompt, { model, temperature, apiUrl: config.apiUrl || 'http://localhost:11434' })
      case 'azure':
        return await callAzureOpenAI(prompt, { model, temperature, maxTokens, apiKey: config.apiKey, apiUrl: config.apiUrl })
      default:
        return await callOpenAI(prompt, { model, temperature, maxTokens, apiKey: config.apiKey })
    }
  } catch (err) {
    logger.error({ err, provider: config.provider }, 'LLM API call failed')
    throw err
  }
}

/**
 * Call OpenAI API
 */
async function callOpenAI(prompt, { model, temperature, maxTokens, apiKey }) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens: maxTokens,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenAI API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}

/**
 * Call Anthropic Claude API
 */
async function callAnthropic(prompt, { model, temperature, maxTokens, apiKey }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-3-sonnet-20240229',
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Anthropic API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  return data.content[0].text
}

/**
 * Call local Ollama instance
 */
async function callOllama(prompt, { model, temperature, apiUrl }) {
  const response = await fetch(`${apiUrl}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || 'llama2',
      prompt,
      temperature,
      stream: false,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Ollama API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  return data.response
}

/**
 * Call Azure OpenAI API
 */
async function callAzureOpenAI(prompt, { model, temperature, maxTokens, apiKey, apiUrl }) {
  if (!apiUrl) {
    throw new Error('Azure OpenAI requires apiUrl')
  }

  const response = await fetch(`${apiUrl}/openai/deployments/${model}/chat/completions?api-version=2024-02-01`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens: maxTokens,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Azure OpenAI API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}

/**
 * Get mock response for testing without API
 */
function getMockResponse(prompt) {
  if (prompt.includes('extract paper metadata')) {
    return JSON.stringify({
      isAcademicPaper: true,
      title: 'Mock Paper Title',
      abstract: 'This is a mock abstract for testing purposes.',
      authors: ['Author One', 'Author Two'],
      keywords: ['finance', 'economics', 'testing'],
    })
  }
  
  if (prompt.includes('generate search queries')) {
    return JSON.stringify({
      queries: [
        'asset pricing models',
        'market efficiency hypothesis',
        'financial econometrics',
      ],
    })
  }

  if (prompt.includes('dimension scores')) {
    return JSON.stringify({
      originality: 7,
      research_question: 6,
      claims_supported: 7,
      experiments: 6,
      clarity: 8,
      community_value: 7,
      prior_work_context: 6,
    })
  }

  return 'Mock LLM response for: ' + prompt.substring(0, 100)
}

/**
 * Extract paper metadata from markdown
 */
async function extractPaperMetadata(markdown) {
  const prompt = `You are an expert academic paper analyzer. Please extract paper metadata from the following academic paper content.

PAPER CONTENT:
${markdown.substring(0, 15000)}

Please respond with a JSON object containing:
{
  "isAcademicPaper": boolean (true if this appears to be an academic research paper),
  "title": string (the paper title),
  "abstract": string (the paper abstract, if found),
  "authors": array of strings (author names, if found),
  "keywords": array of strings (keywords or key topics),
  "field": string (primary research field - e.g., "finance", "economics", "macroeconomics"),
  "methodology": string (brief description of methodology if identifiable)
}

Respond ONLY with the JSON object, no other text.`

  const response = await callLLM(prompt)
  
  try {
    return JSON.parse(response)
  } catch {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
    throw new Error('Failed to parse paper metadata response')
  }
}

/**
 * Generate search queries for related work
 */
async function generateSearchQueries({ paperTitle, paperAbstract, keywords, domain }) {
  const prompt = `You are an expert in finance and economics research. Generate search queries to find related academic papers.

PAPER TITLE: ${paperTitle}

PAPER ABSTRACT: ${paperAbstract || 'Not available'}

KEYWORDS: ${keywords?.join(', ') || 'Not available'}

DOMAIN: ${domain}

Generate diverse search queries at different specificity levels:
1. Highly specific queries (exact methodology, specific variables)
2. Topic-level queries (research area, general approach)
3. Related benchmarks or baselines in finance/economics
4. Alternative approaches to the same problem
5. Foundational papers in the field

Consider finance/economics specific aspects:
- Econometric methods used
- Market/sector focus
- Time period or geographic scope
- Policy implications

Respond with a JSON object:
{
  "queries": [array of 8-12 search query strings]
}

Respond ONLY with the JSON object, no other text.`

  const response = await callLLM(prompt)
  
  try {
    const parsed = JSON.parse(response)
    return parsed.queries || []
  } catch {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return parsed.queries || []
    }
    // Fallback: extract queries from text
    return paperTitle.split(' ').filter(w => w.length > 3).slice(0, 5)
  }
}

/**
 * Evaluate relevance of related papers
 */
async function evaluateRelevance({ originalPaper, relatedPapers, maxPapers = 10 }) {
  if (!relatedPapers || relatedPapers.length === 0) {
    return []
  }

  const prompt = `You are an expert in finance and economics research. Evaluate the relevance of potential related papers.

ORIGINAL PAPER:
Title: ${originalPaper.title}
Abstract: ${originalPaper.abstract || 'Not available'}

CANDIDATE RELATED PAPERS:
${relatedPapers.slice(0, 30).map((p, i) => `
${i + 1}. Title: ${p.title}
   Abstract: ${p.abstract?.substring(0, 500) || 'Not available'}
`).join('\n')}

For each paper, assess:
1. Methodological relevance (similar econometric approaches)
2. Topical relevance (same research questions or markets)
3. Whether it should be cited or compared against

Select the top ${maxPapers} most relevant papers and explain why for each.

Respond with a JSON object:
{
  "selectedPapers": [
    {
      "index": number (1-based index from the list above),
      "relevanceScore": number (1-10),
      "relevanceReason": string,
      "summarizationMethod": "abstract" or "detailed",
      "focusAreas": [array of aspects to focus on in detailed summary]
    }
  ]
}

Respond ONLY with the JSON object, no other text.`

  const response = await callLLM(prompt)
  
  try {
    const parsed = JSON.parse(response)
    return parsed.selectedPapers.map(selection => {
      const paper = relatedPapers[selection.index - 1]
      return {
        ...paper,
        relevanceScore: selection.relevanceScore,
        relevanceReason: selection.relevanceReason,
        summarizationMethod: selection.summarizationMethod,
        focusAreas: selection.focusAreas,
      }
    }).filter(p => p)
  } catch {
    // Fallback: return top papers by original relevance score
    return relatedPapers.slice(0, maxPapers)
  }
}

/**
 * Generate detailed summary for a paper
 */
async function generateDetailedSummary({ title, fullText, focusAreas }) {
  const prompt = `You are an expert in finance and economics research. Generate a detailed summary of the following paper.

PAPER TITLE: ${title}

PAPER CONTENT:
${fullText.substring(0, 20000)}

FOCUS AREAS: ${focusAreas?.join(', ') || 'general summary'}

Generate a comprehensive summary covering:
1. Main research question and hypothesis
2. Data and sample description
3. Methodology (econometric approach, identification strategy)
4. Key findings and results
5. Contribution to the literature
6. Limitations acknowledged by authors

Respond with a JSON object:
{
  "title": string,
  "summary": string (2-3 paragraph comprehensive summary),
  "researchQuestion": string,
  "methodology": string,
  "keyFindings": [array of key findings],
  "dataDescription": string,
  "contribution": string,
  "limitations": [array of limitations]
}

Respond ONLY with the JSON object, no other text.`

  const response = await callLLM(prompt)
  
  try {
    return JSON.parse(response)
  } catch {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
    return {
      title,
      summary: response.substring(0, 1000),
      keyFindings: [],
    }
  }
}

/**
 * Extract key findings from abstract
 */
async function extractKeyFindings(abstract) {
  if (!abstract) return []

  const prompt = `Extract the key findings from this finance/economics paper abstract:

${abstract}

Respond with a JSON array of 2-4 key findings:
["finding 1", "finding 2", ...]

Respond ONLY with the JSON array, no other text.`

  const response = await callLLM(prompt)
  
  try {
    return JSON.parse(response)
  } catch {
    const arrayMatch = response.match(/\[[\s\S]*\]/)
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0])
    }
    return [abstract.substring(0, 200)]
  }
}

/**
 * Generate dimension scores for a paper
 */
async function generateDimensionScores({ paperMarkdown, metadata, relatedWorkSummaries, dimensions, financeEconCriteria }) {
  const prompt = `You are an expert reviewer for top finance and economics journals. Evaluate this paper on multiple dimensions.

PAPER TITLE: ${metadata.title}

PAPER ABSTRACT: ${metadata.abstract || 'Not available'}

PAPER CONTENT (excerpt):
${paperMarkdown.substring(0, 15000)}

RELATED WORK FOR COMPARISON:
${relatedWorkSummaries.slice(0, 5).map(p => `- ${p.title}: ${p.summary?.substring(0, 200) || 'No summary'}`).join('\n')}

FINANCE/ECONOMICS SPECIFIC CRITERIA TO CONSIDER:
${Object.entries(financeEconCriteria).map(([category, criteria]) => 
  `${category}:\n${criteria.map(c => `  - ${c}`).join('\n')}`
).join('\n\n')}

Score the paper on these dimensions (1-10 scale):
${dimensions.map(d => `- ${d.name}: ${d.key}`).join('\n')}

For each dimension, consider:
- Finance/economics standards and expectations
- Quality relative to top-tier journal publications
- Comparison to the related work provided

Respond with a JSON object of scores:
{
  "originality": number,
  "research_question": number,
  "claims_supported": number,
  "experiments": number,
  "clarity": number,
  "community_value": number,
  "prior_work_context": number
}

Respond ONLY with the JSON object, no other text.`

  const response = await callLLM(prompt)
  
  try {
    return JSON.parse(response)
  } catch {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
    // Return default scores
    return {
      originality: 5,
      research_question: 5,
      claims_supported: 5,
      experiments: 5,
      clarity: 5,
      community_value: 5,
      prior_work_context: 5,
    }
  }
}

/**
 * Generate comprehensive review text
 */
async function generateReviewText({ paperMarkdown, metadata, relatedWorkSummaries, dimensionScores, financeEconCriteria, targetVenue }) {
  const prompt = `You are an expert reviewer for top finance and economics journals. Generate a comprehensive, constructive review.

PAPER TITLE: ${metadata.title}

PAPER ABSTRACT: ${metadata.abstract || 'Not available'}

PAPER CONTENT (excerpt):
${paperMarkdown.substring(0, 12000)}

DIMENSION SCORES:
${Object.entries(dimensionScores).map(([k, v]) => `- ${k}: ${v}/10`).join('\n')}

RELATED WORK:
${relatedWorkSummaries.slice(0, 5).map(p => `- ${p.title}`).join('\n')}

TARGET VENUE: ${targetVenue}

Generate a thorough academic review including:

1. SUMMARY (2-3 sentences describing what the paper does)

2. STRENGTHS (bullet points)
   - What does the paper do well?
   - Novel contributions
   - Methodological strengths

3. WEAKNESSES (bullet points with constructive framing)
   - Areas needing improvement
   - Gaps in analysis
   - Missing related work

4. FINANCE/ECONOMICS SPECIFIC EVALUATION
   ${Object.entries(financeEconCriteria).map(([category, criteria]) => 
     `- ${category}`
   ).join('\n   ')}

5. SUGGESTIONS FOR IMPROVEMENT
   - Specific, actionable recommendations
   - Additional analyses that could strengthen the paper

6. MINOR ISSUES
   - Typos, formatting, clarity issues

Respond with a JSON object:
{
  "summary": string,
  "strengths": [array of strings],
  "weaknesses": [array of strings],
  "financeEconSpecific": {
    "methodological_rigor": string,
    "data_quality": string,
    "theoretical_foundation": string,
    "policy_relevance": string
  },
  "suggestions": [array of strings],
  "minorIssues": [array of strings],
  "overallAssessment": string
}

Respond ONLY with the JSON object, no other text.`

  const response = await callLLM(prompt, { maxTokens: 6000 })
  
  try {
    return JSON.parse(response)
  } catch {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
    return {
      summary: 'Review generation failed. Please check LLM configuration.',
      strengths: [],
      weaknesses: [],
      suggestions: [],
    }
  }
}

/**
 * Generate actionable feedback
 */
async function generateActionableFeedback({ reviewText, dimensionScores, metadata }) {
  const prompt = `Based on the following review, generate specific, actionable feedback for the authors.

PAPER: ${metadata.title}

REVIEW SUMMARY: ${reviewText.summary || ''}

STRENGTHS: ${reviewText.strengths?.join('; ') || 'Not available'}

WEAKNESSES: ${reviewText.weaknesses?.join('; ') || 'Not available'}

DIMENSION SCORES:
${Object.entries(dimensionScores).map(([k, v]) => `- ${k}: ${v}/10`).join('\n')}

Provide 3-5 specific, actionable recommendations that would most improve this paper. Each recommendation should:
1. Be specific and concrete
2. Be achievable within a reasonable revision timeframe
3. Address the most impactful weaknesses
4. Include guidance on how to implement

Respond with a JSON object:
{
  "priorities": [
    {
      "priority": number (1-5, where 1 is highest priority),
      "recommendation": string (specific action to take),
      "rationale": string (why this matters),
      "implementation": string (how to do it)
    }
  ],
  "quickWins": [array of minor improvements that are easy to implement]
}

Respond ONLY with the JSON object, no other text.`

  const response = await callLLM(prompt)
  
  try {
    return JSON.parse(response)
  } catch {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
    return {
      priorities: [],
      quickWins: [],
    }
  }
}

const LLMService = {
  callLLM,
  getLLMConfig,
  extractPaperMetadata,
  generateSearchQueries,
  evaluateRelevance,
  generateDetailedSummary,
  extractKeyFindings,
  generateDimensionScores,
  generateReviewText,
  generateActionableFeedback,
}

export default LLMService
