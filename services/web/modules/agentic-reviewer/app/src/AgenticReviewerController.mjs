import OError from '@overleaf/o-error'
import { expressify } from '@overleaf/promise-utils'
import Settings from '@overleaf/settings'
import Path from 'node:path'
import logger from '@overleaf/logger'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import AgenticReviewerService from './AgenticReviewerService.mjs'
import PaperSourceService from './PaperSourceService.mjs'

/**
 * Agentic Reviewer Controller
 * Handles HTTP requests for the agentic paper review system
 * Designed for finance and economics papers
 */

async function reviewerPage(req, res) {
  const sessionUser = SessionManager.getSessionUser(req.session)
  
  if (!sessionUser) {
    return res.redirect('/login')
  }

  res.render(Path.resolve(import.meta.dirname, '../views/reviewer'), {
    title: 'Agentic Paper Reviewer',
    user: sessionUser,
  })
}

async function submitPaper(req, res) {
  const sessionUser = SessionManager.getSessionUser(req.session)
  const { paperPath, targetVenue, options } = req.body

  if (!paperPath) {
    logger.debug({}, 'no paper path supplied')
    return res.status(400).json({
      success: false,
      message: 'Paper path is required',
    })
  }

  try {
    logger.debug({ paperPath, userId: sessionUser._id }, 'submitting paper for review')
    
    const reviewId = await AgenticReviewerService.submitForReview({
      paperPath,
      targetVenue: targetVenue || 'finance',
      userId: sessionUser._id,
      options: options || {},
    })

    res.json({
      success: true,
      reviewId,
      message: 'Paper submitted for review',
    })
  } catch (err) {
    OError.tag(err, 'error submitting paper for review', {
      paperPath,
      userId: sessionUser._id,
    })
    throw err
  }
}

async function getReviewStatus(req, res) {
  const sessionUser = SessionManager.getSessionUser(req.session)
  const { reviewId } = req.params

  try {
    const status = await AgenticReviewerService.getStatus(reviewId, sessionUser._id)
    res.json(status)
  } catch (err) {
    if (err.message === 'Review not found') {
      return res.status(404).json({
        success: false,
        message: 'Review not found',
      })
    }
    throw err
  }
}

async function getReviewResult(req, res) {
  const sessionUser = SessionManager.getSessionUser(req.session)
  const { reviewId } = req.params

  try {
    const result = await AgenticReviewerService.getResult(reviewId, sessionUser._id)
    res.json(result)
  } catch (err) {
    if (err.message === 'Review not found') {
      return res.status(404).json({
        success: false,
        message: 'Review not found',
      })
    }
    if (err.message === 'Review not complete') {
      return res.status(202).json({
        success: false,
        message: 'Review is still in progress',
      })
    }
    throw err
  }
}

async function listReviews(req, res) {
  const sessionUser = SessionManager.getSessionUser(req.session)

  try {
    const reviews = await AgenticReviewerService.listUserReviews(sessionUser._id)
    res.json({
      success: true,
      reviews,
    })
  } catch (err) {
    throw err
  }
}

async function listLocalPapers(req, res) {
  try {
    const papers = await PaperSourceService.listLocalPapers()
    res.json({
      success: true,
      papers,
    })
  } catch (err) {
    throw err
  }
}

async function searchRelatedWork(req, res) {
  const { queries, paperTitle } = req.body

  if (!queries || !Array.isArray(queries) || queries.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Search queries are required',
    })
  }

  try {
    const relatedPapers = await PaperSourceService.searchRelatedWork({
      queries,
      paperTitle: paperTitle || '',
    })

    res.json({
      success: true,
      relatedPapers,
    })
  } catch (err) {
    throw err
  }
}

const AgenticReviewerController = {
  reviewerPage: expressify(reviewerPage),
  submitPaper: expressify(submitPaper),
  getReviewStatus: expressify(getReviewStatus),
  getReviewResult: expressify(getReviewResult),
  listReviews: expressify(listReviews),
  listLocalPapers: expressify(listLocalPapers),
  searchRelatedWork: expressify(searchRelatedWork),
}

export default AgenticReviewerController
