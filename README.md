# node-red-contrib-dongtine

Custom Node-RED nodes for industrial IoT / Smart Factory applications at the Giay Dong Tien Long An

This package is built to integrate realtime production data from PLCs (S7, Modbus), process diverse device measurement variables (such as the iLec MFM300 multi-function power meter), standardize device metadata into a hierarchical structure, and automatically ingest high-precision Line Protocol data into InfluxDB v1.8/v2.x for Dashboards, OEE, and Energy Monitoring.

## Key Features

- Connects and processes real-time data from PLCs and field meters (Modbus/S7).
- Generates dynamic metadata optimized for the Giay Dong Tien Long An plant:
    - `factory`: Manufacturing site (default: "Giay Dong Tien Long An")
    - `transformer`: Source power transformer (5000KVA, 3000KVA, 2500KVA, etc.)
    - `parent_system`: Parent power distribution panel (Main Station, MCC 1.1, MCC XEO, etc.)
    - `sub_system`: Terminal consumption subsystem (Long-fiber disc grinder, Boiler, Paper Machine, etc.)
    - `device`: Dynamic Vietnamese display name mapped directly to technical field acronyms (e.g. "Dien ap pha A", for `Ua`, "Dong dien pha B" for `Ib`).
    - `shift`: Automatically updated work shifts.
- Smart stream partitioning into individual Line Protocol points or aggregated by custom Templates.
- Dedicated data ingestion node directly targeting InfluxDB with high precision configurations (`ns`, `ms`).
- Readily extensible for Energy Monitoring. Overall Equipment Effectiveness (OEE), Max Balance, and Wastewater Treatment monitoring.

## 📁 Node Structure

This current package includes the following custom nodes:
- `dongtine-config`: Defines plant metadata and power panel/device hierarchies.
- `dongtien-group-template`: Clusters Modbus/S7 signals according to predefined structural templates.
- `dongtien-s7-group`: Reads and breaks down Data Blocks (DB) for Siemens PLCs into semantic groups.
- `dongtien-insert`: Transform data structures and writes directly to InfluxDB via Line Protocol (Automaps localized names to the `device` tag).

## ⚙️ Environment Requirements

- Node.js >= 20 (LTS recommended)
- Node-RED > 3.x
- npm >= 10
- Docker & Docker Compose (for local containerized testing)

## 🚀 Development Setup

### 1. Project Initialization and Git Configuration

```bash
mkdir node-red-contrib-dongtien && cd node-red-contrib-dongtien
npm init -v
git init
echo "node_modules/\n.node-red/\n*.tgz\ndist/\n.env" > .gitignore
git add -A
git commit -m "chore(init): initialize dongtien project"
```

### 2. TypeScript Installation and Setup

```bash
npm i -D typescript@5.8.3 @types/node @types/node-red
npx tsc --init
```

*(Configure `tsconfig.json` to point `outDir` to `"./dist"` and `rootDir` to `"./src"`)*

### 3. Commit Controls Setup (Commitlint & Husky)

Enforces Conventional Commits to maintain standard commit logs and automate versioning inside the CI/CD pipeline.

```bash
# Install Commitlint
npm i -D @commitlint/config-conventional@19.8.0 @commitlint/cli@19.8.0
echo "export default { extends: ['@commitlint/config-conventional'] };" > commitlint.config.ts

# Install and activate Husky
npm i -D husky@9.1.7
npx husky init

# Create commit message validation hook
echo 'npx --no --commitlint --edit ${1}' > .husky/commit-msg
chmod +x .husky/commit-msg

# Commit init configuration changes
git add -A
git commit -m "chore(commitlint): initial conventional commit tools"
```

### 4. Code Quality Configuration (ESLint)

```bash
npm install -D eslint
npx eslint --init
git add -A
git commit -m "chore(eslint): initialize eslint"
```

### 5. Node.js Management via NVM (Node v22 Recommended)

```bash
curl -o- [https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh](https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh) | bash
source ~/.zshrc

# Install and set default Node version
nvm install 22
nvm use 22
nvm alias default 22
```

## ▶️ Local Development & Execution Flow

### 1. Build TypeSript Source Code

```bash
npm run build
```

### 2. Local Containerized Testing (Unpublished NPM Package)

If the package is under local development, use `npm link` to mount it directly into a Dockerized Node-RED environment.

#### Recommended `docker-compose.yml` Configuration:

```yaml
version: '3.8'
services:
    node-red:
        image: nodered/node-red:latest
        container_name: dongtien-node-red
        ports:
            - "1880:1880"
        volumes:
            - ./data:/data
            - .:/workspace/node-red-contrib-dongtien
```

#### Link the Package into the Running Container:

Execute the following block to symlink your development workspace directly inside the container's Node-RED runtime path:

```bash
sudo docker exec -it dongtien-node-red sh -c `
cd /workspace/node-red-contrib-dongtien && \
npm install && \
npm link && \
cd /data && \
npm link node-red-contrib-dongtien
`
```

#### Restart the Container to Apply Changes:

```bash
sudo docker restart dongtien-node-red
```

## 🔄 Automated CI/CD Workflow (.github/workflows/ci-cd.yml)

To automate linting, compilation, packaging, and deployment into a internal registry or the official NPM Registry, add this GitHub Actions configuration under `.github/workflows/ci-cd.yml`:

```yaml
name: CI/CD Node-RED DongTien Node

on:
    push:
        branches: [ main, master ]
    pull_request:
        branches: [ main, master ]

jobs:
    continuous-integration:
        runs-on: ubuntu-latest
        steps:
            - name: Checkout Source Code
              uses: actions/checkout@v4
            
            - name: Setup Node.js 22
              uses: actions/setup-node@v4
              with:
                node-version: 22
                cache: 'npm'

            - name: Install Dependencies
              run: npm ci

            - name: Run Code Linter (Linting)
              run: npm run lint

            - name: Compile TypeScript to JavaScript
              run: npm run build

            # Uncomment below once unit testing suites are added
            # - name: Run Unit Tests
            #   run: npm test

    continuous-deployment:
        node: continuous-integration
        runs-on: ubuntu-latest
        if: github.ref == 'refs/heads/main' && github.event_name == 'push'
        steps:
            - name: Checkout Source Code
              uses: actions/checkout@v4
              with
                token: ${{ secrets.GTIHUB_TOKEN }}

            - name: Setup Node.js 22
              uses: actions/setup-node@v4
              with:
                node-version: 22
                registry-url: '[https://registry.npmjs.org](https://registry.npmjs.org)' # Adjust if using a private registry
        
            - name: Install Dependencies
              run: npm ci

            - name: Compile Distribution Files
              run: npm run build
              
            - name: Configure Git for Auto-Versioning
              run: |
                git config --local user.email "action@github.com"
                git config --local user.name "GitHub Action"

            - name: Bump Patch Version
              run: npm version patch -m "core(release): bump version to %s [skip ci]"

            - name: Pack Internal Tarball (.tgz)
              run: npm pack

            - name: Upload Tarball Artifact
              uses: actions/upload-artifact@v4
              with:
                name: node-red-contrib-dongtien-latest
                path: "*.tgz"

            - name: Publish Package to Registry
              run: npm publish
              env:
                NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN  }}

            - name: Push Version Changes and Tags to Origin
              run: git push origin main --tags
```

## 📝 Conventional Commit Rules

To trigger version increments correctly through the CI/CD pipeline, commits must follow this explicit patterns:

```
feat(node): add measurement handling node for iLec MFM300 power meters
fix(influx): resolve timestamp nano-second precision shift on Influx 1.8
docs(readme): update hierarchical equipment mapping for 5000KVA station
refactor(insert): optimize script for dynamic Vietnamese device tag generation
chore(deps): upgrade typescript library dependency to 5.8.3
```

## 📊 Practical Factory Use Cases

This package is pre-configured to adapt easily to the following factory segments:
- **Pubping & Grinding Systems**: MCC 1.1 Panel (Long-fiber disc grinder, Short-fiber disc grinder, Heat disperser), MCC 1.3 Panel (Hydrapulper, Pulping air compressor).
- **Paper Machine Systems (XEO)**: MCC XEO Panel (Reel screen, Vacuum pump 1, Vacuum pump 3, XEO Air compressors 1 & 2).
- **Auxiliary Power Infrastructure**: Wastewater Treatment Plant (530A CB), XEO Drive Systems (400A ACB), and Solar Energy Panels (Factory Roof Solar, Office Building Solar via 600A ATS).
