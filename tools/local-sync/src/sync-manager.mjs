/**
 * Project Sync Manager
 * Handles syncing between local directories and Overleaf projects
 * Includes Jupyter notebook to LaTeX conversion
 */

import fs from 'fs-extra'
import path from 'path'
import { pipeline } from 'stream/promises'
import unzipper from 'unzipper'
import crypto from 'crypto'
import chokidar from 'chokidar'

import config from './config.mjs'
import OverleafClient from './api-client.mjs'
import { convertNotebookToLatex, checkNbconvert } from './notebook-converter.mjs'

/**
 * Calculate file hash for change detection
 */
function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', data => hash.update(data))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

/**
 * Project Sync Manager class
 */
export class SyncManager {
  constructor() {
    this.client = null
    this.config = null
    this.watchers = new Map()
    this.syncInProgress = new Set()
  }

  /**
   * Initialize the sync manager
   */
  async initialize() {
    this.config = await config.loadConfig()

    if (!this.config.credentials) {
      throw new Error('No credentials configured. Please run "overleaf-sync login" first.')
    }

    this.client = new OverleafClient(this.config.overleafUrl, this.config.credentials)

    // Ensure sync directory exists
    await fs.ensureDir(this.config.syncDirectory)
  }

  /**
   * List all projects from Overleaf
   */
  async listRemoteProjects() {
    if (!this.client) {
      await this.initialize()
    }

    return await this.client.listProjects()
  }

  /**
   * List all local project directories
   */
  async listLocalProjects() {
    const syncDir = this.config.syncDirectory
    const entries = await fs.readdir(syncDir, { withFileTypes: true })

    const projects = []
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const localPath = path.join(syncDir, entry.name)
        const mapping = await config.getProjectMapping(localPath)
        projects.push({
          name: entry.name,
          localPath,
          mapping,
        })
      }
    }

    return projects
  }

  /**
   * Download a project from Overleaf to a local directory
   */
  async downloadProject(projectId, projectName, targetDir = null) {
    if (!this.client) {
      await this.initialize()
    }

    const localPath = targetDir || path.join(this.config.syncDirectory, projectName)

    // Skip if sync already in progress for this project
    if (this.syncInProgress.has(projectId)) {
      console.log(`Sync already in progress for ${projectName}, skipping...`)
      return localPath
    }

    this.syncInProgress.add(projectId)

    try {
      // Download the project as ZIP
      console.log(`Downloading project: ${projectName}...`)
      const zipBuffer = await this.client.downloadProject(projectId)

      // Create a temporary file for the ZIP
      const tempZipPath = path.join(this.config.syncDirectory, `.${projectId}.zip.tmp`)
      await fs.writeFile(tempZipPath, zipBuffer)

      // Ensure target directory exists
      await fs.ensureDir(localPath)

      // Extract the ZIP
      console.log(`Extracting to: ${localPath}...`)
      await pipeline(
        fs.createReadStream(tempZipPath),
        unzipper.Extract({ path: localPath })
      )

      // Clean up temp file
      await fs.remove(tempZipPath)

      // Update project mapping
      await config.setProjectMapping(localPath, projectId, projectName)

      console.log(`Downloaded project: ${projectName}`)
      return localPath
    } finally {
      this.syncInProgress.delete(projectId)
    }
  }

  /**
   * Create a new project on Overleaf from a local directory
   */
  async createProjectFromDirectory(localPath, projectName = null) {
    if (!this.client) {
      await this.initialize()
    }

    const dirName = path.basename(localPath)
    const name = projectName || dirName

    // Check if mapping already exists
    const existingMapping = await config.getProjectMapping(localPath)
    if (existingMapping) {
      console.log(`Project mapping already exists for ${localPath}`)
      return existingMapping.projectId
    }

    // Check if project name already exists on Overleaf
    const remoteProjects = await this.listRemoteProjects()
    const existing = remoteProjects.find(p => p.name === name)

    if (existing) {
      console.log(`Project "${name}" already exists on Overleaf, linking...`)
      await config.setProjectMapping(localPath, existing.id, name)
      return existing.id
    }

    // Create new project on Overleaf
    console.log(`Creating new project on Overleaf: ${name}...`)
    const result = await this.client.createProject(name, this.config.defaultTemplate)

    // Update mapping
    await config.setProjectMapping(localPath, result.project_id, name)

    // Upload local files to the new project
    await this.uploadLocalFiles(localPath, result.project_id)

    console.log(`Created project: ${name} (${result.project_id})`)
    return result.project_id
  }

  /**
   * Upload local files to an Overleaf project
   */
  async uploadLocalFiles(localPath, projectId) {
    // Get the project structure to find the root folder ID
    const projectInfo = await this.client.getProject(projectId)
    const rootFolderId = projectInfo.rootFolder?.[0]?._id || 'root'

    // Get all files in the local directory
    const files = await this.getLocalFiles(localPath)

    for (const file of files) {
      const relativePath = path.relative(localPath, file)
      console.log(`Uploading: ${relativePath}...`)

      try {
        await this.client.uploadFile(projectId, rootFolderId, file)
      } catch (error) {
        console.error(`Failed to upload ${relativePath}: ${error.message}`)
      }
    }
  }

  /**
   * Get all files in a directory recursively
   */
  async getLocalFiles(dirPath, files = []) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)

      // Skip hidden files and directories
      if (entry.name.startsWith('.')) continue

      if (entry.isDirectory()) {
        await this.getLocalFiles(fullPath, files)
      } else {
        files.push(fullPath)
      }
    }

    return files
  }

  /**
   * Convert all Jupyter notebooks in a directory to LaTeX
   */
  async convertNotebooks(dirPath) {
    const hasNbconvert = await checkNbconvert()
    if (!hasNbconvert) {
      console.log('Warning: nbconvert not available, skipping notebook conversion')
      return []
    }

    const files = await this.getLocalFiles(dirPath)
    const notebooks = files.filter(f => f.endsWith('.ipynb'))
    const converted = []

    for (const nbPath of notebooks) {
      try {
        console.log(`Converting notebook: ${path.basename(nbPath)}...`)
        const result = await convertNotebookToLatex(nbPath, null, dirPath)
        converted.push(result)
        console.log(`  -> ${path.basename(result.outputPath)}`)
      } catch (error) {
        console.error(`Failed to convert ${path.basename(nbPath)}: ${error.message}`)
      }
    }

    return converted
  }

  /**
   * Sync all projects - download missing, upload new
   */
  async syncAll() {
    if (!this.client) {
      await this.initialize()
    }

    console.log('Starting full sync...')

    // Get remote projects
    const remoteProjects = await this.listRemoteProjects()
    const remoteProjectMap = new Map(remoteProjects.map(p => [p.id, p]))

    // Get local projects
    const localProjects = await this.listLocalProjects()
    const mappings = await config.getAllProjectMappings()

    // Download projects that exist on Overleaf but not locally
    for (const remote of remoteProjects) {
      const localExists = localProjects.find(
        l => l.mapping?.projectId === remote.id
      )

      if (!localExists) {
        console.log(`Downloading missing project: ${remote.name}`)
        await this.downloadProject(remote.id, remote.name)
      }
    }

    // Create projects for local directories without mappings
    for (const local of localProjects) {
      if (!local.mapping) {
        console.log(`Creating project for local directory: ${local.name}`)
        await this.createProjectFromDirectory(local.localPath)
      }
    }

    // Sync existing mapped projects
    for (const [localPath, mapping] of Object.entries(mappings)) {
      if (await fs.pathExists(localPath)) {
        console.log(`Syncing: ${mapping.projectName}`)
        await this.downloadProject(mapping.projectId, mapping.projectName, localPath)
      }
    }

    console.log('Full sync complete.')
  }

  /**
   * Watch for local file changes and sync automatically
   */
  startWatching() {
    if (this.watchers.size > 0) {
      console.log('Already watching for changes')
      return
    }

    console.log(`Watching for changes in: ${this.config.syncDirectory}`)

    const watcher = chokidar.watch(this.config.syncDirectory, {
      ignored: /(^|[/\\])\../, // Ignore dotfiles
      persistent: true,
      ignoreInitial: true,
      depth: 10,
    })

    watcher.on('change', async filePath => {
      console.log(`File changed: ${filePath}`)
      await this.handleLocalChange(filePath)
    })

    watcher.on('add', async filePath => {
      console.log(`File added: ${filePath}`)
      await this.handleLocalChange(filePath)
    })

    watcher.on('unlink', async filePath => {
      console.log(`File deleted: ${filePath}`)
      // Handle file deletion if needed
    })

    this.watchers.set(this.config.syncDirectory, watcher)
  }

  /**
   * Handle a local file change
   */
  async handleLocalChange(filePath) {
    // Find the project directory this file belongs to
    const relativePath = path.relative(this.config.syncDirectory, filePath)
    const projectDirName = relativePath.split(path.sep)[0]
    const projectPath = path.join(this.config.syncDirectory, projectDirName)

    // Get the mapping for this project
    const mapping = await config.getProjectMapping(projectPath)

    if (mapping) {
      console.log(`Change detected in project: ${mapping.projectName}`)
      // You could implement upload of changed files here
      // For now, just log the change
    } else {
      console.log(`Change detected in unmapped directory: ${projectDirName}`)
    }
  }

  /**
   * Stop watching for file changes
   */
  stopWatching() {
    for (const [, watcher] of this.watchers) {
      watcher.close()
    }
    this.watchers.clear()
    console.log('Stopped watching for changes')
  }

  /**
   * Start auto-sync with periodic polling
   */
  startAutoSync(interval = null) {
    const syncInterval = interval || this.config.syncInterval

    console.log(`Starting auto-sync every ${syncInterval / 1000} seconds...`)

    // Do initial sync
    this.syncAll().catch(err => {
      console.error('Initial sync failed:', err.message)
    })

    // Start watching for local changes
    if (this.config.watchForChanges) {
      this.startWatching()
    }

    // Set up periodic sync
    this.syncTimer = setInterval(async () => {
      try {
        await this.syncAll()
      } catch (err) {
        console.error('Periodic sync failed:', err.message)
      }
    }, syncInterval)
  }

  /**
   * Stop auto-sync
   */
  stopAutoSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer)
      this.syncTimer = null
    }
    this.stopWatching()
    console.log('Stopped auto-sync')
  }
}

export default SyncManager
