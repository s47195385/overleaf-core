# Overleaf Local Sync

A command-line tool for syncing local directories with Overleaf projects. Each subdirectory in your sync folder represents one Overleaf project, enabling seamless bidirectional synchronization.

## Features

- **Multi-project sync**: Each subdirectory is mapped to a separate Overleaf project
- **Auto-sync on startup**: Automatically downloads missing projects and syncs on launch
- **Project auto-creation**: New local directories are automatically created as Overleaf projects
- **Secure credential storage**: Credentials are encrypted at rest
- **Self-hosted support**: Works with both Overleaf.com and self-hosted instances
- **Watch mode**: Detects local file changes in real-time
- **Configurable sync interval**: Customize how often to sync
- **Jupyter notebook conversion**: Convert `.ipynb` files to LaTeX for Overleaf

## Installation

```bash
# From the overleaf-core repository
cd tools/local-sync
npm install

# Make the CLI available globally (optional)
npm link
```

## Quick Start

1. **Configure your credentials**:
   ```bash
   overleaf-sync login
   ```

2. **Start syncing**:
   ```bash
   overleaf-sync start
   ```

That's it! The tool will:
- Download all your Overleaf projects to `~/overleaf-projects/`
- Create Overleaf projects for any local directories not yet on Overleaf
- Keep everything in sync automatically

## Commands

### Authentication

```bash
# Login with your Overleaf credentials
overleaf-sync login

# Login to a self-hosted instance
overleaf-sync login --url https://your-overleaf.com

# Clear stored credentials
overleaf-sync logout
```

### Project Management

```bash
# List all projects (remote and local)
overleaf-sync list

# List only remote Overleaf projects
overleaf-sync list --remote

# List only local directories
overleaf-sync list --local

# Download a specific project
overleaf-sync download <project-id>
overleaf-sync download --name "My Project"

# Create an Overleaf project from a local directory
overleaf-sync create my-thesis
overleaf-sync create ./path/to/directory --name "Custom Name"

# Link a local directory to an existing project
overleaf-sync link my-thesis abc123project456id

# Unlink a directory from its project
overleaf-sync unlink my-thesis
```

### Syncing

```bash
# Sync once and exit
overleaf-sync sync --once

# Start continuous sync (daemon mode)
overleaf-sync start

# Sync with custom interval (in seconds)
overleaf-sync sync --interval 60
overleaf-sync start --interval 60
```

### Jupyter Notebook Conversion

Convert Jupyter notebooks (`.ipynb`) to LaTeX (`.tex`) for Overleaf:

```bash
# Convert all notebooks in the sync directory
overleaf-sync convert

# Convert notebooks in a specific directory
overleaf-sync convert my-thesis

# Convert a single notebook
overleaf-sync convert my-thesis/analysis.ipynb

# Convert with custom output path
overleaf-sync convert my-thesis/analysis.ipynb --output paper.tex
```

**Requirements**: Python with `nbconvert` installed (`pip install nbconvert`)

The converter supports:
- Automatic metadata extraction (title, authors, date, keywords)
- Custom directives for tables (`tbl`), figures (`fig`), code tables (`codetbl`), math tables (`mathtbl`)
- Cross-references (`[@fig:label]`, `[@tbl:label]`)
- Markdown footnotes
- Abstract formatting
- Bibliography integration (`.bib` files)
- Appendix handling

### Configuration

```bash
# View current configuration
overleaf-sync config

# Set sync directory
overleaf-sync config --dir /path/to/sync/folder

# Set Overleaf server URL
overleaf-sync config --url https://your-overleaf.com

# Check sync status
overleaf-sync status
```

## Configuration

Configuration is stored in `~/.overleaf-sync/`:
- `config.json` - Settings and encrypted credentials
- `projects.json` - Project mappings (local path → Overleaf ID)
- `.key` - Encryption key for credentials

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `overleafUrl` | `https://www.overleaf.com` | Overleaf server URL |
| `syncDirectory` | `~/overleaf-projects` | Local sync directory |
| `syncInterval` | `30000` | Sync interval in milliseconds |
| `autoSync` | `true` | Enable automatic syncing |
| `watchForChanges` | `true` | Watch for local file changes |
| `defaultTemplate` | `basic` | Template for new projects (`basic` or `example`) |

## Directory Structure

```
~/overleaf-projects/
├── my-thesis/           # → Linked to Overleaf project "my-thesis"
│   ├── main.tex
│   ├── analysis.ipynb   # Can be converted to .tex
│   ├── bibliography.bib
│   └── figures/
├── paper-draft/         # → Linked to Overleaf project "paper-draft"
│   └── main.tex
└── new-project/         # → Will be created on Overleaf
    └── main.tex
```

## Notebook Metadata Format

When converting notebooks, metadata is extracted from the first markdown cell:

```markdown
title: My Research Paper
subtitle: A Comprehensive Analysis
date: 2024
keywords: machine learning, data science

authors:
  - John Doe | University of Example | john@example.com
  - Jane Smith | Another University

supervisors:
  - Prof. Smith | University of Example
```

### Custom Directives

In markdown cells, use these directives:

**Tables:**
```markdown
```tbl {#tbl:results title="Results" src="data.csv"}
```
```

**Figures:**
```markdown
fig {#fig:diagram src="images/diagram.png" scale=0.8 caption="System architecture"}
```

**Code tables:**
```markdown
```codetbl {#tbl:code title="Algorithm Steps"}
| Step | Code | Description |
| 1 | x = 0 | Initialize |
| 2 | x += 1 | Increment |
```
```

**Cross-references:**
```markdown
As shown in [@fig:diagram] and [@tbl:results]...
```

## Programmatic Usage

You can also use the sync functionality programmatically:

```javascript
import { SyncManager, config } from '@overleaf/local-sync'
import { convertNotebookToLatex } from '@overleaf/local-sync/src/notebook-converter.mjs'

// Initialize and start sync
const syncManager = new SyncManager()
await syncManager.initialize()

// List remote projects
const projects = await syncManager.listRemoteProjects()

// Download a project
await syncManager.downloadProject('project-id', 'project-name')

// Create a project from local directory
await syncManager.createProjectFromDirectory('/path/to/dir')

// Convert notebooks in a directory
await syncManager.convertNotebooks('/path/to/project')

// Convert a single notebook
const result = await convertNotebookToLatex('/path/to/notebook.ipynb')

// Start auto-sync
syncManager.startAutoSync(30000) // 30 seconds interval
```

## Self-Hosted Overleaf

To use with a self-hosted Overleaf instance:

```bash
# During login
overleaf-sync login --url https://your-overleaf.example.com

# Or update config
overleaf-sync config --url https://your-overleaf.example.com
```

## Security Notes

- Credentials are encrypted using AES-256-GCM before storage
- The encryption key is stored with restrictive permissions (600)
- Never commit the `~/.overleaf-sync/` directory to version control
- Consider using environment variables or a secrets manager for CI/CD

## Troubleshooting

### Authentication fails

1. Ensure your email and password are correct
2. For self-hosted instances, verify the URL is correct
3. Check if 2FA is enabled (not currently supported)

### Sync not working

1. Check your internet connection
2. Verify credentials with `overleaf-sync status`
3. Try logging out and back in

### Project not appearing

1. Run `overleaf-sync list --remote` to see all remote projects
2. Ensure the project isn't archived or trashed
3. Check the project mapping with `overleaf-sync status`

### Notebook conversion fails

1. Ensure Python and nbconvert are installed: `pip install nbconvert`
2. Check the notebook is valid JSON
3. Look for syntax errors in markdown cells

## Contributing

Contributions are welcome! Please see the main Overleaf [CONTRIBUTING.md](../../CONTRIBUTING.md) guide.

## License

AGPL-3.0-only - See [LICENSE](../../LICENSE) for details.
