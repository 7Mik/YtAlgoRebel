<div align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/AI-Transformers.js-orange?style=for-the-badge&logo=huggingface&logoColor=white" alt="Transformers.js" />
  <img src="https://img.shields.io/badge/Ollama-Local_Support-white?style=for-the-badge&logo=ollama&logoColor=black" alt="Ollama Support" />
  <img src="https://img.shields.io/badge/Vanilla-CSS_Premium-hotpink?style=for-the-badge&logo=css3&logoColor=white" alt="Vanilla CSS" />

  <h1>🚀 YtAlgoRebel</h1>
  <h3>The AI-Powered YouTube Subscription Reranker</h3>
  <p>Take back control of your YouTube feed. YtAlgoRebel runs entirely in your browser, uses local AI to understand your actual tastes, and violently penalizes clickbait.</p>

  [**Installation**](#installation) • 
  [**How It Works**](#how-it-works) • 
  [**Philosophy**](#project-philosophy) • 
  [**Contributing**](#contributing)
</div>

<br/>

## 🌟 Project Philosophy

YouTube's algorithm prioritizes engagement and watch time. This creates a feed saturated with clickbait, outrage content, and chronologically confusing Subscription tabs. 

**YtAlgoRebel** is an open-source browser extension that solves this by:
1. **Never using official YouTube APIs:** We avoid restrictive quotas by intercepting internal YouTube traffic natively.
2. **100% Local AI:** Your data stays yours. We calculate your "Taste Matrix" and rank videos using WebAssembly (`transformers.js`) or your local Ollama instance. No remote cloud processing.
3. **The Anti-Clickbait Engine:** Our Cosine Similarity reranker aggressively identifies and penalizes typical clickbait syntax and semantics.

## ⚙️ How It Works

1. **The Interceptor:** We inject hooks into the YouTube DOM to intercept `/youtubei/v1/browse` payloads. 
2. **The Taste Matrix:** Videos you watch and like form a dense embedding matrix stored securely in `IndexedDB`.
3. **The Reranker:** New videos are embedded via `Xenova/all-MiniLM-L6-v2` and scored against your matrix using Cosine Similarity.
4. **The Render:** The default YouTube feed is stripped and replaced with the pure, reranked, AI-curated UI.

## 🚀 Installation

### Prerequisites
- Node.js (v18+)
- (Optional) [Ollama](https://ollama.com/) running locally for high-performance embeddings.

### Local Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/YtAlgoRebel.git
   cd YtAlgoRebel
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the extension:
   ```bash
   npm run build
   ```
4. Load into Chrome/Brave/Edge:
   - Go to `chrome://extensions/`
   - Enable **Developer mode**
   - Click **Load unpacked** and select the `dist/` directory.

## 🛠 Configuration (Ollama vs WebAssembly)

By default, YtAlgoRebel uses `transformers.js` to run embeddings directly inside the browser using WebAssembly. While impressive, this can be resource-intensive.

If you have **Ollama** installed:
1. Start Ollama and run `ollama pull nomic-embed-text`.
2. Open the YtAlgoRebel popup.
3. Switch the AI Engine to "Ollama (Local)".
4. Enjoy lightning-fast local embeddings.

## 🛣 Roadmap

- [x] Reverse-engineer YouTube internal feed endpoints.
- [x] Integrate WebAssembly embeddings in background scripts.
- [x] Build premium Vanilla CSS popup dashboard.
- [ ] Direct DOM injection to replace YouTube's native grid natively.
- [ ] Add cross-device sync for the Taste Matrix (E2E Encrypted).
- [ ] Auto-Categorization (e.g., "Tech", "Gaming", "News") based on embeddings clustering.

## 🤝 Contributing

We welcome rebels! Check out our [CONTRIBUTING.md](./CONTRIBUTING.md) to see how you can help destroy the engagement-bait algorithm.

## 📜 License

MIT License - Because algorithms should be open.
