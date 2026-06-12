# Contributing to YtAlgoRebel 🚀

First off, thank you for considering contributing to YtAlgoRebel! It's people like you that make open-source software such a great community to learn, inspire, and create.

## 🧠 Philosophy

Our goal is to build an uncompromisingly local, privacy-first, and highly intelligent AI reranker. 
Any PR should align with these core tenets:
- **No external server calls** (except for locally-hosted instances like Ollama).
- **Fast & Lightweight**.
- **Aesthetic excellence** (Vanilla CSS only, no massive frameworks).

## 🛠️ Development Setup

1. **Fork** the repo on GitHub
2. **Clone** the project to your own machine
3. **Install** dependencies: `npm install`
4. **Watch mode** for development: `npm run watch` (This will continuously build the `dist/` folder).
5. Load the `dist/` folder into Chrome as an Unpacked Extension.

## 📝 Pull Request Process

1. Ensure any new code is clean and well-commented.
2. If you are modifying the AI Engine (`background/ai.js` or `background/reranker.js`), test the embeddings thoroughly.
3. If you are tweaking the UI (`popup.css`), ensure the aesthetic remains premium (Glassmorphism, Dark mode natively).
4. Update the `README.md` with details of changes to the interface, if applicable.
5. Submit your PR and await review!

## 🐛 Bug Reports & Feature Requests

Please use the GitHub Issue tracker. Provide as much context as possible:
- Your Browser and Version
- Whether you are using WebAssembly or Ollama
- Steps to reproduce the issue

Welcome to the Rebellion!
