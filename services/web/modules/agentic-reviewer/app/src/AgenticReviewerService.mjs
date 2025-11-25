import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import crypto from 'node:crypto'
import PdfToMarkdownService from './PdfToMarkdownService.mjs'
import PaperSourceService from './PaperSourceService.mjs'
import LLMService from './LLMService.mjs'

/**
 * Agentic Reviewer Service
 * 
 * Core service implementing the agentic reviewer workflow:
 * 1. Convert PDF to Markdown
 * 2. Extract paper title and verify it's an academic paper
 * 3. Generate search queries at different specificity levels
 * 4. Search for related work (from local papers directory)
 * 5. Evaluate relevance and summarize related papers
 * 6. Generate comprehensive review with 7-dimension scoring
 * 
 * Optimized for finance and economics papers.
 */

// In-memory store for reviews (in production, use a database)
const reviewStore = new Map()

/**
 * Review dimensions for scoring
 */
const REVIEW_DIMENSIONS = [
  { key: 'originality', name: 'Originality', weight: 0.18 },
  { key: 'research_question', name: 'Importance of Research Question', weight: 0.15 },
  { key: 'claims_supported', name: 'Claims Well Supported', weight: 0.15 },
  { key: 'experiments', name: 'Soundness of Experiments/Analysis', weight: 0.14 },
  { key: 'clarity', name: 'Clarity of Writing', weight: 0.12 },
  { key: 'community_value', name: 'Value to Research Community', weight: 0.13 },
  { key: 'prior_work_context', name: 'Contextualized vs Prior Work', weight: 0.13 },
]

/**
 * Finance/Economics specific evaluation criteria
 */
const FINANCE_ECON_CRITERIA = {
  methodological_rigor: [
    'Are econometric methods appropriately applied?',
    'Is causal identification properly addressed?',
    'Are standard errors correctly computed (clustering, heteroskedasticity)?',
    'Is endogeneity addressed?',
  ],
  data_quality: [
    'Is the data source clearly described?',
    'Are sample selection criteria transparent?',
    'Is survivorship bias addressed if applicable?',
    'Are data limitations acknowledged?',
  ],
  theoretical_foundation: [
    'Is the theoretical framework well-established?',
    'Are key assumptions explicitly stated?',
    'Is the model well-specified?',
    'Does the theory connect to empirical predictions?',
  ],
  policy_relevance: [
    'Are policy implications clearly articulated?',
    'Is the external validity discussed?',
    'Are welfare implications considered?',
    'Is practical applicability addressed?',
  ],
}

/**
 * Generate a unique review ID
 */
function generateReviewId() {
  return crypto.randomBytes(16).toString('hex')
}

/**
 * Submit a paper for review
 */
async function submitForReview({ paperPath, targetVenue, userId, options }) {
  const reviewId = generateReviewId()
  const timestamp = new Date().toISOString()

  // Initialize review record
  const review = {
    reviewId,
    userId,
    paperPath,
    targetVenue,
    options,
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
    steps: [],
    result: null,
    error: null,
  }

  reviewStore.set(reviewId, review)

  // Start async processing
  processReview(reviewId).catch(err => {
    logger.error({ reviewId, err }, 'Error processing review')
    const review = reviewStore.get(reviewId)
    if (review) {
      review.status = 'failed'
      review.error = err.message
      review.updatedAt = new Date().toISOString()
    }
  })

  return reviewId
}

/**
 * Process the review asynchronously
 * This implements the main agentic workflow
 */
async function processReview(reviewId) {
  const review = reviewStore.get(reviewId)
  if (!review) {
    throw new Error('Review not found')
  }

  try {
    updateReviewStep(review, 'Converting PDF to Markdown')

    // Step 1: Convert PDF to Markdown
    const paperMarkdown = await PdfToMarkdownService.convert(review.paperPath)
    review.paperMarkdown = paperMarkdown

    // Step 2: Extract title and verify it's an academic paper
    updateReviewStep(review, 'Extracting paper metadata')
    const metadata = await LLMService.extractPaperMetadata(paperMarkdown)
    review.metadata = metadata

    if (!metadata.isAcademicPaper) {
      throw new Error('The document does not appear to be an academic paper')
    }

    // Step 3: Generate search queries for related work
    updateReviewStep(review, 'Generating search queries for related work')
    const searchQueries = await LLMService.generateSearchQueries({
      paperTitle: metadata.title,
      paperAbstract: metadata.abstract,
      keywords: metadata.keywords,
      domain: 'finance_economics',
    })
    review.searchQueries = searchQueries

    // Step 4: Search for related work in local papers
    updateReviewStep(review, 'Searching for related work')
    const relatedPapers = await PaperSourceService.searchRelatedWork({
      queries: searchQueries,
      paperTitle: metadata.title,
    })
    review.relatedPapers = relatedPapers

    // Step 5: Evaluate relevance and select top papers
    updateReviewStep(review, 'Evaluating relevance of related papers')
    const topRelatedPapers = await LLMService.evaluateRelevance({
      originalPaper: {
        title: metadata.title,
        abstract: metadata.abstract,
      },
      relatedPapers,
      maxPapers: 10,
    })
    review.topRelatedPapers = topRelatedPapers

    // Step 6: Summarize related papers
    updateReviewStep(review, 'Summarizing related papers')
    const relatedWorkSummaries = await generateRelatedWorkSummaries(topRelatedPapers)
    review.relatedWorkSummaries = relatedWorkSummaries

    // Step 7: Generate comprehensive review
    updateReviewStep(review, 'Generating comprehensive review')
    const reviewResult = await generateComprehensiveReview({
      paperMarkdown,
      metadata,
      relatedWorkSummaries,
      targetVenue: review.targetVenue,
    })

    review.result = reviewResult
    review.status = 'completed'
    review.updatedAt = new Date().toISOString()

    logger.info({ reviewId, title: metadata.title }, 'Review completed successfully')
  } catch (err) {
    logger.error({ reviewId, err }, 'Error in review processing')
    review.status = 'failed'
    review.error = err.message
    review.updatedAt = new Date().toISOString()
    throw err
  }
}

/**
 * Update review progress step
 */
function updateReviewStep(review, step) {
  review.status = 'processing'
  review.currentStep = step
  review.steps.push({
    step,
    timestamp: new Date().toISOString(),
  })
  review.updatedAt = new Date().toISOString()
  logger.debug({ reviewId: review.reviewId, step }, 'Review step updated')
}

/**
 * Generate summaries for related papers
 */
async function generateRelatedWorkSummaries(relatedPapers) {
  const summaries = []

  for (const paper of relatedPapers) {
    try {
      // Determine summarization method based on available data
      const summarizationMethod = paper.hasFullText ? 'detailed' : 'abstract_based'

      let summary
      if (summarizationMethod === 'detailed' && paper.fullText) {
        // Generate detailed summary from full text
        summary = await LLMService.generateDetailedSummary({
          title: paper.title,
          fullText: paper.fullText,
          focusAreas: paper.focusAreas || [],
        })
      } else {
        // Use abstract-based summary
        summary = {
          title: paper.title,
          authors: paper.authors,
          summary: paper.abstract,
          keyFindings: await LLMService.extractKeyFindings(paper.abstract),
          methodology: 'Not available (abstract only)',
        }
      }

      summaries.push({
        ...summary,
        relevanceScore: paper.relevanceScore,
        source: paper.source || 'local',
      })
    } catch (err) {
      logger.warn({ paper: paper.title, err }, 'Error summarizing related paper')
      summaries.push({
        title: paper.title,
        summary: paper.abstract || 'Summary not available',
        error: err.message,
      })
    }
  }

  return summaries
}

/**
 * Generate comprehensive review with 7-dimension scoring
 */
async function generateComprehensiveReview({
  paperMarkdown,
  metadata,
  relatedWorkSummaries,
  targetVenue,
}) {
  // Generate dimension scores
  const dimensionScores = await LLMService.generateDimensionScores({
    paperMarkdown,
    metadata,
    relatedWorkSummaries,
    dimensions: REVIEW_DIMENSIONS,
    financeEconCriteria: FINANCE_ECON_CRITERIA,
  })

  // Calculate overall score using weighted average
  let overallScore = 0
  for (const dimension of REVIEW_DIMENSIONS) {
    const score = dimensionScores[dimension.key] || 5
    overallScore += score * dimension.weight
  }

  // Generate detailed review text
  const reviewText = await LLMService.generateReviewText({
    paperMarkdown,
    metadata,
    relatedWorkSummaries,
    dimensionScores,
    financeEconCriteria: FINANCE_ECON_CRITERIA,
    targetVenue,
  })

  // Generate actionable feedback
  const actionableFeedback = await LLMService.generateActionableFeedback({
    reviewText,
    dimensionScores,
    metadata,
  })

  return {
    title: metadata.title,
    overallScore: Math.round(overallScore * 10) / 10,
    dimensionScores,
    reviewText,
    actionableFeedback,
    relatedWorkSummaries,
    methodology: reviewText.methodology || null,
    strengths: reviewText.strengths || [],
    weaknesses: reviewText.weaknesses || [],
    suggestions: reviewText.suggestions || [],
    financeEconSpecific: reviewText.financeEconSpecific || null,
    generatedAt: new Date().toISOString(),
    disclaimer: 'This review is AI-generated and may contain errors. It is intended to provide rapid feedback to help improve your research, not as a substitute for peer review.',
  }
}

/**
 * Get review status
 */
async function getStatus(reviewId, userId) {
  const review = reviewStore.get(reviewId)
  
  if (!review) {
    throw new Error('Review not found')
  }

  if (review.userId !== userId) {
    throw new Error('Review not found')
  }

  return {
    reviewId: review.reviewId,
    status: review.status,
    currentStep: review.currentStep,
    steps: review.steps,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    error: review.error,
  }
}

/**
 * Get review result
 */
async function getResult(reviewId, userId) {
  const review = reviewStore.get(reviewId)
  
  if (!review) {
    throw new Error('Review not found')
  }

  if (review.userId !== userId) {
    throw new Error('Review not found')
  }

  if (review.status !== 'completed') {
    throw new Error('Review not complete')
  }

  return {
    success: true,
    reviewId: review.reviewId,
    result: review.result,
    metadata: review.metadata,
    createdAt: review.createdAt,
    completedAt: review.updatedAt,
  }
}

/**
 * List user's reviews
 */
async function listUserReviews(userId) {
  const reviews = []
  
  for (const [, review] of reviewStore) {
    if (review.userId === userId) {
      reviews.push({
        reviewId: review.reviewId,
        paperPath: review.paperPath,
        status: review.status,
        title: review.metadata?.title,
        overallScore: review.result?.overallScore,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
      })
    }
  }

  return reviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

const AgenticReviewerService = {
  submitForReview,
  processReview,
  getStatus,
  getResult,
  listUserReviews,
  REVIEW_DIMENSIONS,
  FINANCE_ECON_CRITERIA,
}

export default AgenticReviewerService
