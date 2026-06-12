import { pipeline, env } from '@xenova/transformers';

// Skip local model checks since we're in a browser extension environment
env.allowLocalModels = false;

// Disable multi-threading because Service Workers do not support URL.createObjectURL
env.backends.onnx.wasm.numThreads = 1;

class EmbeddingPipeline {
    static task = 'feature-extraction';
    static model = 'Xenova/all-MiniLM-L6-v2';
    static instance = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            this.instance = pipeline(this.task, this.model, { progress_callback });
        }
        return this.instance;
    }
}

export const getAIConfig = async () => {
    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get([
                'useOllama', 'ollamaUrl', 'ollamaModel', 
                'useOpenAI', 'openAIKey', 'openAIUrl', 'openAIModel'
            ], (result) => {
                resolve({
                    useOllama: result.useOllama || false,
                    ollamaUrl: result.ollamaUrl || 'http://localhost:11434',
                    ollamaModel: result.ollamaModel || 'mxbai-embed-large:latest',
                    useOpenAI: result.useOpenAI || false,
                    openAIKey: result.openAIKey || '',
                    openAIUrl: result.openAIUrl || 'https://api.openai.com/v1',
                    openAIModel: result.openAIModel || 'text-embedding-3-small'
                });
            });
        } else {
            resolve({ 
                useOllama: false, 
                ollamaUrl: 'http://localhost:11434',
                ollamaModel: 'mxbai-embed-large:latest',
                useOpenAI: false,
                openAIKey: '',
                openAIUrl: 'https://api.openai.com/v1',
                openAIModel: 'text-embedding-3-small'
            });
        }
    });
};

export const generateEmbeddings = async (text, progressCallback) => {
    try {
        const config = await getAIConfig();

        // 1. BYOK: OpenAI or OpenAI-Compatible Remote API
        if (config.useOpenAI && config.openAIKey) {
            try {
                let url = config.openAIUrl.trim();
                if (!url.endsWith('/embeddings') && !url.endsWith('/embeddings/')) {
                    url = url.replace(/\/+$/, '') + '/embeddings';
                }

                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${config.openAIKey}`
                    },
                    body: JSON.stringify({
                        model: config.openAIModel,
                        input: text
                    })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.data && data.data.length > 0) {
                        return data.data[0].embedding;
                    }
                } else {
                    console.warn("OpenAI API failed, status:", response.status);
                }
            } catch (err) {
                console.warn("Error calling OpenAI, falling back:", err);
            }
        }

        // 2. Local Server: Ollama
        if (config.useOllama) {
            try {
                let url = config.ollamaUrl.trim();
                if (!url.endsWith('/api/embeddings') && !url.endsWith('/api/embed') && !url.endsWith('/api/embeddings/') && !url.endsWith('/api/embed/')) {
                    url = url.replace(/\/+$/, '') + '/api/embeddings';
                }

                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: config.ollamaModel,
                        prompt: text
                    })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.embedding) {
                        return data.embedding;
                    }
                } else {
                    console.warn("Ollama embedding failed, status:", response.status);
                }
            } catch (err) {
                console.warn("Error calling Ollama, falling back to local transformers:", err);
            }
        }

        // 3. Fully Local Browser: Transformers.js WebAssembly
        const embedder = await EmbeddingPipeline.getInstance(progressCallback);
        const output = await embedder(text, { pooling: 'mean', normalize: true });
        
        return Array.from(output.data);
    } catch (error) {
        console.error("Error generating embeddings:", error);
        throw error;
    }
};
