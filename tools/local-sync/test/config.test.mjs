/**
 * Tests for the configuration module
 */

import assert from 'assert'
import fs from 'fs-extra'
import path from 'path'
import os from 'os'

// Use a temporary directory for tests
const TEST_CONFIG_DIR = path.join(os.tmpdir(), 'overleaf-sync-test-' + Date.now())

// Override the config module paths for testing
process.env.OVERLEAF_SYNC_CONFIG_DIR = TEST_CONFIG_DIR

describe('Config Module', function () {
  // Clean up before and after tests
  before(async function () {
    await fs.ensureDir(TEST_CONFIG_DIR)
  })

  after(async function () {
    await fs.remove(TEST_CONFIG_DIR)
  })

  describe('loadConfig', function () {
    it('should return default config when no config file exists', async function () {
      // Import after setting env var
      const { loadConfig } = await import('../src/config.mjs')

      const config = await loadConfig()

      assert.ok(config)
      assert.strictEqual(config.overleafUrl, 'https://www.overleaf.com')
      assert.strictEqual(config.autoSync, true)
      assert.ok(config.syncDirectory.includes('overleaf-projects'))
    })
  })

  describe('saveConfig and loadConfig', function () {
    it('should save and load config correctly', async function () {
      const { loadConfig, saveConfig } = await import('../src/config.mjs')

      const testConfig = {
        overleafUrl: 'https://test.overleaf.com',
        syncInterval: 60000,
        autoSync: false,
      }

      await saveConfig(testConfig)
      const loaded = await loadConfig()

      assert.strictEqual(loaded.overleafUrl, testConfig.overleafUrl)
      assert.strictEqual(loaded.syncInterval, testConfig.syncInterval)
      assert.strictEqual(loaded.autoSync, testConfig.autoSync)
    })
  })

  describe('credentials', function () {
    it('should encrypt and decrypt credentials', async function () {
      const { setCredentials, getCredentials, clearCredentials } = await import(
        '../src/config.mjs'
      )

      const testCredentials = {
        email: 'test@example.com',
        password: 'testpassword123',
      }

      await setCredentials(testCredentials)
      const loaded = await getCredentials()

      assert.deepStrictEqual(loaded, testCredentials)

      await clearCredentials()
      const cleared = await getCredentials()
      assert.strictEqual(cleared, null)
    })
  })

  describe('project mappings', function () {
    it('should manage project mappings', async function () {
      const {
        setProjectMapping,
        getProjectMapping,
        removeProjectMapping,
        getAllProjectMappings,
      } = await import('../src/config.mjs')

      const testPath = '/test/path/project1'
      const testProjectId = 'abc123'
      const testProjectName = 'Test Project'

      // Set mapping
      await setProjectMapping(testPath, testProjectId, testProjectName)

      // Get mapping
      const mapping = await getProjectMapping(testPath)
      assert.ok(mapping)
      assert.strictEqual(mapping.projectId, testProjectId)
      assert.strictEqual(mapping.projectName, testProjectName)
      assert.ok(mapping.lastSynced)

      // Get all mappings
      const allMappings = await getAllProjectMappings()
      assert.ok(allMappings[testPath])

      // Remove mapping
      await removeProjectMapping(testPath)
      const removed = await getProjectMapping(testPath)
      assert.strictEqual(removed, null)
    })
  })
})

describe('SyncManager', function () {
  describe('initialization', function () {
    it('should throw error without credentials', async function () {
      const { default: SyncManager } = await import('../src/sync-manager.mjs')

      const syncManager = new SyncManager()

      try {
        await syncManager.initialize()
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.ok(error.message.includes('credentials'))
      }
    })
  })
})

describe('OverleafClient', function () {
  describe('constructor', function () {
    it('should initialize with correct base URL', async function () {
      const { default: OverleafClient } = await import('../src/api-client.mjs')

      const client = new OverleafClient('https://www.overleaf.com/', {
        email: 'test@test.com',
        password: 'test',
      })

      assert.strictEqual(client.baseUrl, 'https://www.overleaf.com')
    })

    it('should handle URLs without trailing slash', async function () {
      const { default: OverleafClient } = await import('../src/api-client.mjs')

      const client = new OverleafClient('https://www.overleaf.com', {
        email: 'test@test.com',
        password: 'test',
      })

      assert.strictEqual(client.baseUrl, 'https://www.overleaf.com')
    })
  })
})
