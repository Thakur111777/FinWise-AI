import type { AIProvider, AIProviderAdapter, AIRequestContext, AIResponse } from '../types/ai';

export class NoopProviderAdapter implements AIProviderAdapter {
  provider: AIProvider;

  constructor(provider: AIProvider = 'custom') {
    this.provider = provider;
  }

  async generate(request: AIRequestContext): Promise<AIResponse> {
    return {
      provider: request.provider,
      model: 'finwise-deterministic-pipeline',
      answer:
        'FinWise AI is ready to route financial questions through a secure backend context builder before any provider call is made.',
      confidence: 0.92,
      citations: ['Financial context builder', 'Deterministic logic layer'],
      generatedAt: new Date().toISOString(),
    };
  }
}
