/**
 * Configuration management for Overleaf Local Sync
 * Handles storing and retrieving credentials, settings, and project mappings
 */

import fs from 'fs-extra'
import path from 'path'
import os from 'os'
import crypto from 'crypto'

// Allow override via environment variable for testing
const CONFIG_DIR = process.env.OVERLEAF_SYNC_CONFIG_DIR || path.join(os.homedir(), '.overleaf-sync')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')
const PROJECTS_FILE = path.join(CONFIG_DIR, 'projects.json')

// Simple encryption for credentials (for basic protection at rest)
const ENCRYPTION_ALGORITHM = 'aes-256-gcm'

function getEncryptionKey() {
  const keyFile = path.join(CONFIG_DIR, '.key')
  if (fs.existsSync(keyFile)) {
    return fs.readFileSync(keyFile)
  }
  const key = crypto.randomBytes(32)
  fs.ensureDirSync(CONFIG_DIR)
  fs.writeFileSync(keyFile, key, { mode: 0o600 })
  return key
}

function encrypt(text) {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return {
    iv: iv.toString('hex'),
    encrypted,
    authTag: authTag.toString('hex'),
  }
}

function decrypt(encryptedData) {
  const key = getEncryptionKey()
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    key,
    Buffer.from(encryptedData.iv, 'hex')
  )
  decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'))
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

/**
 * Default configuration
 */
const defaultConfig = {
  overleafUrl: 'https://www.overleaf.com',
  syncInterval: 30000, // 30 seconds
  autoSync: true,
  watchForChanges: true,
  defaultTemplate: 'basic', // 'basic' or 'example'
  syncDirectory: path.join(os.homedir(), 'overleaf-projects'),
  credentials: null,
}

/**
 * Load configuration from file
 */
export async function loadConfig() {
  try {
    await fs.ensureDir(CONFIG_DIR)

    if (await fs.pathExists(CONFIG_FILE)) {
      const config = await fs.readJson(CONFIG_FILE)

      // Decrypt credentials if they exist
      if (config.credentials && config.credentials.encrypted) {
        try {
          const decrypted = decrypt(config.credentials)
          config.credentials = JSON.parse(decrypted)
        } catch {
          console.warn('Failed to decrypt credentials, they may be corrupted')
          config.credentials = null
        }
      }

      return { ...defaultConfig, ...config }
    }

    return { ...defaultConfig }
  } catch (error) {
    console.error('Error loading config:', error.message)
    return { ...defaultConfig }
  }
}

/**
 * Save configuration to file
 */
export async function saveConfig(config) {
  try {
    await fs.ensureDir(CONFIG_DIR)

    // Encrypt credentials before saving
    const configToSave = { ...config }
    if (configToSave.credentials) {
      configToSave.credentials = encrypt(JSON.stringify(configToSave.credentials))
    }

    await fs.writeJson(CONFIG_FILE, configToSave, { spaces: 2, mode: 0o600 })
  } catch (error) {
    throw new Error(`Failed to save config: ${error.message}`)
  }
}

/**
 * Set credentials (email/password or API token)
 */
export async function setCredentials(credentials) {
  const config = await loadConfig()
  config.credentials = credentials
  await saveConfig(config)
}

/**
 * Get credentials
 */
export async function getCredentials() {
  const config = await loadConfig()
  return config.credentials
}

/**
 * Clear credentials
 */
export async function clearCredentials() {
  const config = await loadConfig()
  config.credentials = null
  await saveConfig(config)
}

/**
 * Load project mappings (local directory -> Overleaf project ID)
 */
export async function loadProjectMappings() {
  try {
    await fs.ensureDir(CONFIG_DIR)

    if (await fs.pathExists(PROJECTS_FILE)) {
      return await fs.readJson(PROJECTS_FILE)
    }

    return { projects: {} }
  } catch (error) {
    console.error('Error loading project mappings:', error.message)
    return { projects: {} }
  }
}

/**
 * Save project mappings
 */
export async function saveProjectMappings(mappings) {
  try {
    await fs.ensureDir(CONFIG_DIR)
    await fs.writeJson(PROJECTS_FILE, mappings, { spaces: 2 })
  } catch (error) {
    throw new Error(`Failed to save project mappings: ${error.message}`)
  }
}

/**
 * Add or update a project mapping
 */
export async function setProjectMapping(localPath, projectId, projectName) {
  const mappings = await loadProjectMappings()
  mappings.projects[localPath] = {
    projectId,
    projectName,
    lastSynced: new Date().toISOString(),
  }
  await saveProjectMappings(mappings)
}

/**
 * Get project mapping for a local path
 */
export async function getProjectMapping(localPath) {
  const mappings = await loadProjectMappings()
  return mappings.projects[localPath] || null
}

/**
 * Remove a project mapping
 */
export async function removeProjectMapping(localPath) {
  const mappings = await loadProjectMappings()
  delete mappings.projects[localPath]
  await saveProjectMappings(mappings)
}

/**
 * Get all project mappings
 */
export async function getAllProjectMappings() {
  const mappings = await loadProjectMappings()
  return mappings.projects
}

/**
 * Update the sync directory setting
 */
export async function setSyncDirectory(directory) {
  const config = await loadConfig()
  config.syncDirectory = path.resolve(directory)
  await saveConfig(config)
}

/**
 * Update the Overleaf URL (for self-hosted instances)
 */
export async function setOverleafUrl(url) {
  const config = await loadConfig()
  config.overleafUrl = url.replace(/\/$/, '') // Remove trailing slash
  await saveConfig(config)
}

export default {
  loadConfig,
  saveConfig,
  setCredentials,
  getCredentials,
  clearCredentials,
  loadProjectMappings,
  saveProjectMappings,
  setProjectMapping,
  getProjectMapping,
  removeProjectMapping,
  getAllProjectMappings,
  setSyncDirectory,
  setOverleafUrl,
  CONFIG_DIR,
}
