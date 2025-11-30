#!/usr/bin/env node

/**
 * Overleaf Local Sync CLI
 * Command-line interface for syncing local directories with Overleaf projects
 */

import { Command } from 'commander'
import chalk from 'chalk'
import readline from 'readline'

import config from '../src/config.mjs'
import SyncManager from '../src/sync-manager.mjs'

const program = new Command()

/**
 * Prompt for user input
 */
function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer)
    })
  })
}

/**
 * Prompt for password (hidden input)
 */
function promptPassword(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise(resolve => {
    // Use muted output for password
    process.stdout.write(question)
    let password = ''

    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')

    const onData = char => {
      if (char === '\n' || char === '\r' || char === '\u0004') {
        process.stdin.setRawMode(false)
        process.stdin.pause()
        process.stdin.removeListener('data', onData)
        process.stdout.write('\n')
        rl.close()
        resolve(password)
      } else if (char === '\u0003') {
        // Ctrl+C
        process.exit()
      } else if (char === '\u007F') {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1)
          process.stdout.write('\b \b')
        }
      } else {
        password += char
        process.stdout.write('*')
      }
    }

    process.stdin.on('data', onData)
  })
}

program
  .name('overleaf-sync')
  .description('Sync local directories with Overleaf projects')
  .version('1.0.0')

// Login command
program
  .command('login')
  .description('Configure Overleaf credentials')
  .option('-e, --email <email>', 'Overleaf account email')
  .option('-u, --url <url>', 'Overleaf server URL (for self-hosted)')
  .action(async options => {
    try {
      console.log(chalk.blue('Configuring Overleaf credentials...'))

      const email = options.email || (await prompt('Email: '))
      const password = await promptPassword('Password: ')

      await config.setCredentials({ email, password })

      if (options.url) {
        await config.setOverleafUrl(options.url)
      }

      // Test the credentials
      console.log(chalk.yellow('Testing credentials...'))
      const syncManager = new SyncManager()
      await syncManager.initialize()
      await syncManager.listRemoteProjects()

      console.log(chalk.green('✓ Credentials saved and verified successfully!'))
    } catch (error) {
      console.error(chalk.red('Error:'), error.message)
      process.exit(1)
    }
  })

// Logout command
program
  .command('logout')
  .description('Clear stored credentials')
  .action(async () => {
    try {
      await config.clearCredentials()
      console.log(chalk.green('✓ Credentials cleared'))
    } catch (error) {
      console.error(chalk.red('Error:'), error.message)
      process.exit(1)
    }
  })

// List command
program
  .command('list')
  .description('List all projects')
  .option('-r, --remote', 'List remote Overleaf projects')
  .option('-l, --local', 'List local project directories')
  .action(async options => {
    try {
      const syncManager = new SyncManager()
      await syncManager.initialize()

      if (options.remote || (!options.local && !options.remote)) {
        console.log(chalk.blue('\nRemote Overleaf Projects:'))
        const remoteProjects = await syncManager.listRemoteProjects()

        if (remoteProjects.length === 0) {
          console.log('  No projects found')
        } else {
          for (const project of remoteProjects) {
            const archived = project.archived ? chalk.yellow(' [archived]') : ''
            const trashed = project.trashed ? chalk.red(' [trashed]') : ''
            console.log(`  • ${project.name}${archived}${trashed}`)
            console.log(chalk.gray(`    ID: ${project.id}`))
          }
        }
      }

      if (options.local || (!options.local && !options.remote)) {
        console.log(chalk.blue('\nLocal Project Directories:'))
        const localProjects = await syncManager.listLocalProjects()

        if (localProjects.length === 0) {
          console.log('  No local projects found')
        } else {
          for (const project of localProjects) {
            const linked = project.mapping
              ? chalk.green(' [linked]')
              : chalk.yellow(' [not linked]')
            console.log(`  • ${project.name}${linked}`)
            console.log(chalk.gray(`    Path: ${project.localPath}`))
            if (project.mapping) {
              console.log(chalk.gray(`    Overleaf ID: ${project.mapping.projectId}`))
            }
          }
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message)
      process.exit(1)
    }
  })

// Download command
program
  .command('download [project-id]')
  .description('Download a project from Overleaf')
  .option('-n, --name <name>', 'Project name (if not using ID)')
  .option('-o, --output <path>', 'Output directory')
  .action(async (projectId, options) => {
    try {
      const syncManager = new SyncManager()
      await syncManager.initialize()

      let targetProjectId = projectId
      let projectName = options.name

      // If no project ID, try to find by name
      if (!targetProjectId && options.name) {
        const projects = await syncManager.listRemoteProjects()
        const found = projects.find(
          p => p.name.toLowerCase() === options.name.toLowerCase()
        )
        if (found) {
          targetProjectId = found.id
          projectName = found.name
        } else {
          console.error(chalk.red(`Project not found: ${options.name}`))
          process.exit(1)
        }
      }

      if (!targetProjectId) {
        console.error(chalk.red('Please provide a project ID or name'))
        process.exit(1)
      }

      // Get project name if not provided
      if (!projectName) {
        const projects = await syncManager.listRemoteProjects()
        const found = projects.find(p => p.id === targetProjectId)
        projectName = found?.name || targetProjectId
      }

      console.log(chalk.blue(`Downloading: ${projectName}...`))
      const localPath = await syncManager.downloadProject(
        targetProjectId,
        projectName,
        options.output
      )
      console.log(chalk.green(`✓ Downloaded to: ${localPath}`))
    } catch (error) {
      console.error(chalk.red('Error:'), error.message)
      process.exit(1)
    }
  })

// Create command
program
  .command('create <directory>')
  .description('Create a new Overleaf project from a local directory')
  .option('-n, --name <name>', 'Project name (defaults to directory name)')
  .action(async (directory, options) => {
    try {
      const syncManager = new SyncManager()
      await syncManager.initialize()

      const localPath = directory.startsWith('/')
        ? directory
        : `${syncManager.config.syncDirectory}/${directory}`

      console.log(chalk.blue(`Creating project from: ${localPath}...`))
      const projectId = await syncManager.createProjectFromDirectory(
        localPath,
        options.name
      )
      console.log(chalk.green(`✓ Created project with ID: ${projectId}`))
    } catch (error) {
      console.error(chalk.red('Error:'), error.message)
      process.exit(1)
    }
  })

// Sync command
program
  .command('sync')
  .description('Sync all projects')
  .option('-o, --once', 'Sync once and exit')
  .option('-i, --interval <seconds>', 'Sync interval in seconds', '30')
  .action(async options => {
    try {
      const syncManager = new SyncManager()
      await syncManager.initialize()

      if (options.once) {
        console.log(chalk.blue('Running one-time sync...'))
        await syncManager.syncAll()
        console.log(chalk.green('✓ Sync complete'))
      } else {
        const interval = parseInt(options.interval, 10) * 1000
        console.log(chalk.blue('Starting continuous sync...'))
        console.log(chalk.gray('Press Ctrl+C to stop'))

        syncManager.startAutoSync(interval)

        // Handle graceful shutdown
        process.on('SIGINT', () => {
          console.log(chalk.yellow('\nStopping sync...'))
          syncManager.stopAutoSync()
          process.exit(0)
        })
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message)
      process.exit(1)
    }
  })

// Config command
program
  .command('config')
  .description('View or modify configuration')
  .option('-s, --set <key=value>', 'Set a configuration value')
  .option('-d, --dir <path>', 'Set the sync directory')
  .option('-u, --url <url>', 'Set the Overleaf server URL')
  .action(async options => {
    try {
      if (options.dir) {
        await config.setSyncDirectory(options.dir)
        console.log(chalk.green(`✓ Sync directory set to: ${options.dir}`))
      }

      if (options.url) {
        await config.setOverleafUrl(options.url)
        console.log(chalk.green(`✓ Overleaf URL set to: ${options.url}`))
      }

      if (options.set) {
        const [key, value] = options.set.split('=')
        const currentConfig = await config.loadConfig()
        currentConfig[key] = value
        await config.saveConfig(currentConfig)
        console.log(chalk.green(`✓ ${key} set to: ${value}`))
      }

      // Display current config
      if (!options.set && !options.dir && !options.url) {
        const currentConfig = await config.loadConfig()
        console.log(chalk.blue('Current Configuration:'))
        console.log(`  Overleaf URL: ${currentConfig.overleafUrl}`)
        console.log(`  Sync Directory: ${currentConfig.syncDirectory}`)
        console.log(`  Auto Sync: ${currentConfig.autoSync}`)
        console.log(`  Sync Interval: ${currentConfig.syncInterval / 1000}s`)
        console.log(`  Watch for Changes: ${currentConfig.watchForChanges}`)
        console.log(`  Default Template: ${currentConfig.defaultTemplate}`)
        console.log(
          `  Credentials: ${currentConfig.credentials ? chalk.green('configured') : chalk.yellow('not configured')}`
        )
        console.log(chalk.gray(`\n  Config directory: ${config.CONFIG_DIR}`))
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message)
      process.exit(1)
    }
  })

// Link command
program
  .command('link <directory> <project-id>')
  .description('Link a local directory to an existing Overleaf project')
  .action(async (directory, projectId) => {
    try {
      const syncManager = new SyncManager()
      await syncManager.initialize()

      const localPath = directory.startsWith('/')
        ? directory
        : `${syncManager.config.syncDirectory}/${directory}`

      // Get project name from Overleaf
      const projects = await syncManager.listRemoteProjects()
      const project = projects.find(p => p.id === projectId)

      if (!project) {
        console.error(chalk.red(`Project not found: ${projectId}`))
        process.exit(1)
      }

      await config.setProjectMapping(localPath, projectId, project.name)
      console.log(chalk.green(`✓ Linked ${directory} to ${project.name}`))
    } catch (error) {
      console.error(chalk.red('Error:'), error.message)
      process.exit(1)
    }
  })

// Unlink command
program
  .command('unlink <directory>')
  .description('Unlink a local directory from its Overleaf project')
  .action(async directory => {
    try {
      const currentConfig = await config.loadConfig()
      const localPath = directory.startsWith('/')
        ? directory
        : `${currentConfig.syncDirectory}/${directory}`

      await config.removeProjectMapping(localPath)
      console.log(chalk.green(`✓ Unlinked ${directory}`))
    } catch (error) {
      console.error(chalk.red('Error:'), error.message)
      process.exit(1)
    }
  })

// Start command (daemon mode)
program
  .command('start')
  .description('Start the sync daemon')
  .option('-i, --interval <seconds>', 'Sync interval in seconds', '30')
  .action(async options => {
    try {
      console.log(chalk.blue('Starting Overleaf Sync daemon...'))

      const syncManager = new SyncManager()
      await syncManager.initialize()

      const interval = parseInt(options.interval, 10) * 1000
      syncManager.startAutoSync(interval)

      console.log(chalk.green('✓ Daemon started'))
      console.log(chalk.gray(`Sync directory: ${syncManager.config.syncDirectory}`))
      console.log(chalk.gray('Press Ctrl+C to stop'))

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log(chalk.yellow('\nStopping daemon...'))
        syncManager.stopAutoSync()
        process.exit(0)
      })

      // Keep the process running
      process.stdin.resume()
    } catch (error) {
      console.error(chalk.red('Error:'), error.message)
      process.exit(1)
    }
  })

// Status command
program
  .command('status')
  .description('Show sync status')
  .action(async () => {
    try {
      const currentConfig = await config.loadConfig()
      const mappings = await config.getAllProjectMappings()

      console.log(chalk.blue('Overleaf Sync Status\n'))

      console.log(chalk.bold('Configuration:'))
      console.log(`  Server: ${currentConfig.overleafUrl}`)
      console.log(`  Sync Directory: ${currentConfig.syncDirectory}`)
      console.log(
        `  Credentials: ${currentConfig.credentials ? chalk.green('✓') : chalk.red('✗')}`
      )

      console.log(chalk.bold('\nLinked Projects:'))
      const projectEntries = Object.entries(mappings)

      if (projectEntries.length === 0) {
        console.log('  No linked projects')
      } else {
        for (const [localPath, mapping] of projectEntries) {
          console.log(`  • ${mapping.projectName}`)
          console.log(chalk.gray(`    Local: ${localPath}`))
          console.log(chalk.gray(`    ID: ${mapping.projectId}`))
          console.log(chalk.gray(`    Last synced: ${mapping.lastSynced}`))
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message)
      process.exit(1)
    }
  })

// Convert command
program
  .command('convert [directory]')
  .description('Convert Jupyter notebooks (.ipynb) to LaTeX (.tex)')
  .option('-o, --output <path>', 'Output file path (for single file)')
  .action(async (directory, options) => {
    try {
      const { convertNotebookToLatex, checkNbconvert } = await import('../src/notebook-converter.mjs')

      // Check if nbconvert is available
      const hasNbconvert = await checkNbconvert()
      if (!hasNbconvert) {
        console.error(chalk.red('Error: nbconvert not found'))
        console.log(chalk.yellow('Install it with: pip install nbconvert'))
        process.exit(1)
      }

      const currentConfig = await config.loadConfig()
      let targetPath

      if (directory) {
        // Check if it's a file or directory
        targetPath = directory.startsWith('/')
          ? directory
          : `${currentConfig.syncDirectory}/${directory}`
      } else {
        // Use current sync directory
        targetPath = currentConfig.syncDirectory
      }

      const stats = await fs.stat(targetPath)

      if (stats.isFile()) {
        // Convert single notebook
        if (!targetPath.endsWith('.ipynb')) {
          console.error(chalk.red('Error: File must be a .ipynb notebook'))
          process.exit(1)
        }

        console.log(chalk.blue(`Converting: ${targetPath}...`))
        const result = await convertNotebookToLatex(targetPath, options.output)
        console.log(chalk.green(`✓ Created: ${result.outputPath}`))
        if (result.meta.title) {
          console.log(chalk.gray(`  Title: ${result.meta.title}`))
        }
      } else if (stats.isDirectory()) {
        // Convert all notebooks in directory
        console.log(chalk.blue(`Converting notebooks in: ${targetPath}...`))

        const syncManager = new SyncManager()
        syncManager.config = currentConfig

        const results = await syncManager.convertNotebooks(targetPath)

        if (results.length === 0) {
          console.log(chalk.yellow('No notebooks found to convert'))
        } else {
          console.log(chalk.green(`✓ Converted ${results.length} notebook(s)`))
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message)
      process.exit(1)
    }
  })

program.parse(process.argv)

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp()
}
