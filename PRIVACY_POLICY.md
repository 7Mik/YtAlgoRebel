# Privacy Policy for YtAlgoRebel

**Last Updated:** 2026-06-14

YtAlgoRebel ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your information when you use the YtAlgoRebel browser extension.

## 1. Information Collection and Use

YtAlgoRebel is designed to be an uncompromisingly local, privacy-first AI reranker. 
- **No External Servers**: We do not send your personal data, browsing history, or YouTube usage data to any external servers or third-party services by default.
- **Local Processing**: All data processing, including AI embeddings and reranking logic, happens entirely locally on your machine within your browser, or via a local LLM instance (e.g., Ollama) if configured by you.
- **Third-Party API Usage (Bring Your Own Key)**: If you choose to configure YtAlgoRebel to use an external OpenAI-compatible API by providing your own API key (BYOK), your data (such as video titles, descriptions, or search queries) will be sent to that third-party provider. In this case, the data processing is no longer strictly local. **It is entirely your choice and responsibility** to share your data with these providers, and you are subject to their respective privacy policies. YtAlgoRebel assumes no responsibility for data handled by external APIs you configure.

## 2. Permissions Justification

To function correctly, the extension requires the following permissions:
- **`storage`**: Used to save your local preferences and configuration settings.
- **`scripting` & `tabs`**: Necessary to interact with YouTube pages in order to read video titles/descriptions for reranking, and to inject the modified algorithm UI seamlessly.
- **Host Permissions (`*://*.youtube.com/*`, `*://myactivity.google.com/*`)**: Required to understand your current YouTube context and history (if applicable) so the local AI model can accurately determine your preferences.

## 3. Data Retention

Because no data is transmitted to us, we do not retain any of your data. Your data lives on your device and is controlled by your browser's local storage. If you uninstall the extension, the local data associated with it will be deleted by your browser.

## 4. Changes to This Privacy Policy

We may update our Privacy Policy from time to time. We will notify you of any changes by updating this file in the repository.

## 5. Contact Us

If you have any questions or suggestions about our Privacy Policy, please open an issue in our GitHub repository.
