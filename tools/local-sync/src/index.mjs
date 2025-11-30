/**
 * Overleaf Local Sync - Main Entry Point
 */

import SyncManager from './sync-manager.mjs'
import config from './config.mjs'

export { SyncManager }
export { config }
export { default as OverleafClient } from './api-client.mjs'
export { 
  convertNotebookToLatex, 
  checkNbconvert, 
  parseMetaFromFirstMd,
  texEscape,
  buildFrontmatter,
  rewriteMdWithDirectives,
  LATEX_HEADER 
} from './notebook-converter.mjs'

/**
 * Quick start function - initializes and starts sync
 */
export async function startSync(options = {}) {
  const syncManager = new SyncManager()
  await syncManager.initialize()

  if (options.autoSync !== false) {
    syncManager.startAutoSync(options.interval)
  }

  return syncManager
}

export default {
  SyncManager,
  config,
  startSync,
}
