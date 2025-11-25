# Local Development Setup Guide

This guide explains how to run Overleaf locally with the Agentic Paper Reviewer and VS Code integration for Markdown/Jupyter notebook editing.

## Quick Start

### 1. Clone and Setup

```bash
# Clone the repository
git clone https://github.com/overleaf/overleaf.git
cd overleaf

# Install dependencies
npm install
```

### 2. Docker Compose Setup

Create a `docker-compose.local.yml` for local development:

```yaml
services:
  sharelatex:
    restart: always
    image: sharelatex/sharelatex
    container_name: sharelatex
    depends_on:
      mongo:
        condition: service_healthy
      redis:
        condition: service_started
    ports:
      - 80:80
    volumes:
      - ~/sharelatex_data:/var/lib/overleaf
      - ./papers:/var/lib/overleaf/papers
    environment:
      OVERLEAF_APP_NAME: Overleaf Local
      OVERLEAF_MONGO_URL: mongodb://mongo/sharelatex
      OVERLEAF_REDIS_HOST: redis
      REDIS_HOST: redis
      ENABLED_LINKED_FILE_TYPES: 'project_file,project_output_file'
      ENABLE_CONVERSIONS: 'true'
      EMAIL_CONFIRMATION_DISABLED: 'true'
      
      # Agentic Reviewer Configuration
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      AGENTIC_PAPERS_DIR: /var/lib/overleaf/papers
      
      # Optional: Use local LLM
      # AGENTIC_LLM_PROVIDER: ollama
      # AGENTIC_LLM_API_URL: http://host.docker.internal:11434

  mongo:
    restart: always
    image: mongo:6.0
    container_name: mongo
    command: '--replSet overleaf'
    volumes:
      - ~/mongo_data:/data/db
      - ./bin/shared/mongodb-init-replica-set.js:/docker-entrypoint-initdb.d/mongodb-init-replica-set.js
    environment:
      MONGO_INITDB_DATABASE: sharelatex
    extra_hosts:
      - mongo:127.0.0.1
    healthcheck:
      test: echo 'db.stats().ok' | mongosh localhost:27017/test --quiet
      interval: 10s
      timeout: 10s
      retries: 5

  redis:
    restart: always
    image: redis:6.2
    container_name: redis
    volumes:
      - ~/redis_data:/data
```

### 3. Start Services

```bash
# Set your API key
export OPENAI_API_KEY=your-api-key

# Start Overleaf
docker-compose -f docker-compose.local.yml up -d

# Create papers directory
mkdir -p papers
```

### 4. Access Overleaf

- Overleaf: http://localhost
- Agentic Reviewer: http://localhost/agentic-reviewer

## VS Code Integration

### Option 1: VS Code Remote Development

Use VS Code's Remote - Containers extension to develop inside the Overleaf container:

1. Install the "Remote - Containers" extension
2. Open the command palette (Ctrl+Shift+P)
3. Select "Remote-Containers: Attach to Running Container"
4. Choose the `sharelatex` container

### Option 2: Local Development Mode

Run the web service locally with hot reload:

```bash
cd services/web

# Install dependencies
npm install

# Set environment variables
export MONGO_CONNECTION_STRING="mongodb://localhost:27017/sharelatex"
export REDIS_HOST=localhost
export OPENAI_API_KEY=your-api-key

# Start in dev mode
npm run dev
```

## Markdown and Jupyter Notebook Integration

### Pandoc Conversion Workflow

The Agentic Reviewer supports Markdown input through automatic conversion:

1. **Write in Markdown**: Use your preferred editor (VS Code, JupyterLab)
2. **Convert to LaTeX**: Use Pandoc for conversion
3. **Compile PDF**: Overleaf compiles the LaTeX
4. **Review**: Submit for AI review

### VS Code Extension Setup

Install these VS Code extensions:

```json
{
  "recommendations": [
    "james-yu.latex-workshop",
    "ms-toolsai.jupyter",
    "yzhang.markdown-all-in-one",
    "davidanson.vscode-markdownlint"
  ]
}
```

### Automatic Compilation Workflow

Create a VS Code task for automatic compilation:

**.vscode/tasks.json**:
```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Convert MD to LaTeX",
      "type": "shell",
      "command": "pandoc",
      "args": [
        "${file}",
        "-o",
        "${fileDirname}/${fileBasenameNoExtension}.tex"
      ],
      "group": "build",
      "problemMatcher": []
    },
    {
      "label": "Compile LaTeX",
      "type": "shell",
      "command": "pdflatex",
      "args": [
        "-interaction=nonstopmode",
        "${fileDirname}/${fileBasenameNoExtension}.tex"
      ],
      "group": "build",
      "dependsOn": "Convert MD to LaTeX"
    },
    {
      "label": "Submit for Review",
      "type": "shell",
      "command": "curl",
      "args": [
        "-X", "POST",
        "http://localhost/api/agentic-reviewer/submit",
        "-H", "Content-Type: application/json",
        "-d", "{\"paperPath\": \"${fileDirname}/${fileBasenameNoExtension}.pdf\"}"
      ],
      "dependsOn": "Compile LaTeX"
    }
  ]
}
```

### Jupyter Notebook to PDF

For `.ipynb` files, use this workflow:

```bash
# Install nbconvert
pip install nbconvert

# Convert notebook to LaTeX
jupyter nbconvert --to latex notebook.ipynb

# Compile to PDF
pdflatex notebook.tex

# Or convert directly to PDF
jupyter nbconvert --to pdf notebook.ipynb
```

**VS Code task for notebooks**:
```json
{
  "label": "Convert Notebook to PDF",
  "type": "shell",
  "command": "jupyter",
  "args": [
    "nbconvert",
    "--to", "pdf",
    "${file}"
  ],
  "group": "build"
}
```

## Watch Mode for Auto-Compilation

Create a file watcher for automatic compilation:

**watch-and-compile.sh**:
```bash
#!/bin/bash

# Watch for changes in .md and .ipynb files
inotifywait -m -e modify,create --include '.*\.(md|ipynb)$' "$1" |
while read -r directory events filename; do
    echo "Change detected: $filename"
    
    base="${filename%.*}"
    ext="${filename##*.}"
    
    if [ "$ext" = "md" ]; then
        pandoc "$directory$filename" -o "$directory$base.tex"
        pdflatex -interaction=nonstopmode "$directory$base.tex"
    elif [ "$ext" = "ipynb" ]; then
        jupyter nbconvert --to pdf "$directory$filename"
    fi
    
    echo "Compilation complete: ${base}.pdf"
done
```

Run with:
```bash
chmod +x watch-and-compile.sh
./watch-and-compile.sh /path/to/your/papers/
```

## Development with Local LLM (Ollama)

For offline development, use Ollama:

```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull a model
ollama pull llama2

# Start Ollama server
ollama serve

# Configure Overleaf to use Ollama
export AGENTIC_LLM_PROVIDER=ollama
export AGENTIC_LLM_MODEL=llama2
export AGENTIC_LLM_API_URL=http://localhost:11434
```

## Paper Directory Structure

Recommended structure for finance/economics papers:

```
papers/
├── reference/           # Classic papers for comparison
│   ├── fama_french/
│   ├── modigliani_miller/
│   └── black_scholes/
├── working/             # Your papers in progress
│   ├── draft_v1.pdf
│   └── draft_v2.pdf
├── by_topic/
│   ├── asset_pricing/
│   ├── corporate_finance/
│   ├── market_microstructure/
│   └── behavioral_finance/
└── by_journal/
    ├── jf/              # Journal of Finance
    ├── jfe/             # Journal of Financial Economics
    ├── rfs/             # Review of Financial Studies
    └── aer/             # American Economic Review
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker-compose logs sharelatex

# Restart containers
docker-compose down && docker-compose up -d
```

### MongoDB replica set issues

```bash
# Initialize replica set manually
docker exec -it mongo mongosh --eval "rs.initiate()"
```

### PDF conversion fails

```bash
# Check pdftotext is installed
docker exec sharelatex which pdftotext

# Install if missing
docker exec sharelatex apt-get update && apt-get install -y poppler-utils
```

### VS Code can't connect

1. Check the port mapping in docker-compose.yml
2. Verify firewall settings
3. Try `localhost` instead of `127.0.0.1`

## Next Steps

1. Add your papers to the `papers/` directory
2. Configure your LLM API key
3. Open http://localhost/agentic-reviewer
4. Submit your first paper for review!

For more information, see the main [README.md](../README.md).
