// arxiv-agent.ts
import { 
    BotAgent, 
    ManifestOptions, 
    UtteranceEvent, 
    Envelope,
    createTextUtterance,
    isUtteranceEvent
  } from '@openfloor/protocol';
  
  interface ArxivPaper {
    title: string;
    authors: string;
    published: string;
    abstract: string;
    link: string;
    category: string;
  }
  
  /**
   * ArxivAgent - Research agent for academic papers and scientific research
   */
  export class ArxivAgent extends BotAgent {
    private readonly baseUrl = 'http://export.arxiv.org/api/query';
    private readonly rateLimitDelay = 2000; // 2 seconds
    private lastRequestTime = 0;
  
    constructor(manifest: ManifestOptions) {
      super(manifest);
    }
  
    async processEnvelope(inEnvelope: Envelope): Promise<Envelope> {
      const responseEvents: any[] = [];
  
      for (const event of inEnvelope.events) {
        const addressedToMe = !event.to || 
          event.to.speakerUri === this.speakerUri || 
          event.to.serviceUrl === this.serviceUrl;
  
        if (addressedToMe && isUtteranceEvent(event)) {
          const responseEvent = await this._handleResearchQuery(event, inEnvelope);
          if (responseEvent) responseEvents.push(responseEvent);
        } else if (addressedToMe && event.eventType === 'getManifests') {
          responseEvents.push({
            eventType: 'publishManifests',
            to: { speakerUri: inEnvelope.sender.speakerUri },
            parameters: {
              servicingManifests: [this.manifest.toObject()]
            }
          });
        }
      }
  
      return new Envelope({
        schema: { version: inEnvelope.schema.version },
        conversation: { id: inEnvelope.conversation.id },
        sender: {
          speakerUri: this.speakerUri,
          serviceUrl: this.serviceUrl
        },
        events: responseEvents
      });
    }
  
    private async _handleResearchQuery(event: UtteranceEvent, inEnvelope: Envelope): Promise<any> {
      try {
        const dialogEvent = event.parameters?.dialogEvent as { features?: any };
        if (!dialogEvent?.features?.text?.tokens?.length) {
          return createTextUtterance({
            speakerUri: this.speakerUri,
            text: "📚 I need a research query to search arXiv for academic papers!",
            to: { speakerUri: inEnvelope.sender.speakerUri }
          });
        }
  
        const query = dialogEvent.features.text.tokens
          .map((token: any) => token.value)
          .join('');
  
        // Check if this looks like an academic query
        if (!this._isAcademicQuery(query)) {
          return createTextUtterance({
            speakerUri: this.speakerUri,
            text: "📚 I specialize in academic research. Try queries about scientific topics, algorithms, machine learning, physics, mathematics, or other research areas. Use terms like 'research', 'study', 'analysis', 'scientific', 'algorithm', 'method', 'machine learning', 'ai', 'artificial intelligence', 'deep learning', 'neural network', 'computer science', 'physics', 'mathematics', 'quantum', 'cryptography', 'blockchain', 'paper', 'academic'",
            to: { speakerUri: inEnvelope.sender.speakerUri }
          });
        }
  
        const results = await this._searchArxiv(query);
        
        return createTextUtterance({
          speakerUri: this.speakerUri,
          text: results,
          to: { speakerUri: inEnvelope.sender.speakerUri }
        });
  
      } catch (error) {
        console.error('Error in ArXiv research:', error);
        return createTextUtterance({
          speakerUri: this.speakerUri,
          text: "📚 I encountered an error while searching arXiv. Please try again with a different query.",
          to: { speakerUri: inEnvelope.sender.speakerUri }
        });
      }
    }
  
    private async _searchArxiv(query: string, maxResults = 5): Promise<string> {
      await this._rateLimit();
  
      try {
        const params = new URLSearchParams({
          search_query: `all:${query}`,
          start: '0',
          max_results: maxResults.toString(),
          sortBy: 'relevance',
          sortOrder: 'descending'
        });
  
        const response = await fetch(`${this.baseUrl}?${params}`, {
          headers: {
            'User-Agent': 'OpenFloor Research Agent (research@openfloor.org)'
          }
        });
  
        if (!response.ok) {
          throw new Error(`ArXiv API error: ${response.status}`);
        }
  
        const xmlText = await response.text();
        const papers = this._parseArxivXML(xmlText);
  
        if (papers.length === 0) {
          return `**arXiv Academic Research for: ${query}**\n\nNo relevant academic papers found on arXiv.`;
        }
  
        let result = `**arXiv Academic Research for: ${query}**\n\n`;
        
        papers.forEach((paper, index) => {
          result += `**Paper ${index + 1}: ${paper.title}**\n`;
          result += `Authors: ${paper.authors}\n`;
          result += `Published: ${paper.published}\n`;
          result += `Category: ${paper.category}\n`;
          result += `Abstract: ${paper.abstract.substring(0, 400)}...\n`;
          result += `Link: ${paper.link}\n\n`;
        });
  
        result += this._assessArxivQuality(papers);
        
        return result;
  
      } catch (error) {
        if (error instanceof Error && error.message.includes('timeout')) {
          return `**arXiv Research for: ${query}**\n\nRequest timeout - arXiv may be experiencing high load. Research available but slower than expected.`;
        }
        throw error;
      }
    }
  
    private _parseArxivXML(xmlText: string): ArxivPaper[] {
      const papers: ArxivPaper[] = [];
      
      try {
        // Simple XML parsing for arXiv entries
        const entryRegex = /<entry>(.*?)<\/entry>/gs;
        const entries = xmlText.match(entryRegex) || [];
  
        for (const entry of entries) {
          const paper = this._parseArxivEntry(entry);
          if (paper) papers.push(paper);
        }
      } catch (error) {
        console.error('Error parsing arXiv XML:', error);
      }
  
      return papers;
    }
  
    private _parseArxivEntry(entry: string): ArxivPaper | null {
      try {
        const titleMatch = entry.match(/<title>(.*?)<\/title>/s);
        const summaryMatch = entry.match(/<summary>(.*?)<\/summary>/s);
        const publishedMatch = entry.match(/<published>(.*?)<\/published>/);
        const idMatch = entry.match(/<id>(.*?)<\/id>/);
        
        // Extract authors
        const authorMatches = entry.match(/<name>(.*?)<\/name>/g) || [];
        const authors = authorMatches
          .map(match => match.replace(/<\/?name>/g, ''))
          .slice(0, 3) // Limit to first 3 authors
          .join(', ');
  
        // Extract category
        const categoryMatch = entry.match(/term="([^"]+)"/);
        
        if (!titleMatch || !summaryMatch) return null;
  
        return {
          title: titleMatch[1].trim().replace(/\n/g, ' '),
          authors: authors || 'Unknown Author',
          published: publishedMatch ? publishedMatch[1].substring(0, 10) : 'Unknown Date',
          abstract: summaryMatch[1].trim().replace(/\n/g, ' '),
          link: idMatch ? idMatch[1] : '',
          category: categoryMatch ? categoryMatch[1] : 'Unknown'
        };
      } catch (error) {
        console.error('Error parsing arXiv entry:', error);
        return null;
      }
    }
  
    private _assessArxivQuality(papers: ArxivPaper[]): string {
      if (papers.length === 0) return '';
  
      const currentYear = new Date().getFullYear();
      const recentPapers = papers.filter(paper => 
        paper.published.startsWith('2024') || paper.published.startsWith('2025')
      ).length;
  
      const mlAiPapers = papers.filter(paper => 
        ['cs.ai', 'cs.lg', 'cs.cv', 'stat.ml'].some(cat => 
          paper.category.toLowerCase().includes(cat)
        )
      ).length;
  
      let assessment = `**Research Quality Assessment:**\n`;
      assessment += `• Papers found: ${papers.length}\n`;
      assessment += `• Recent papers (2024-2025): ${recentPapers}/${papers.length}\n`;
      
      if (mlAiPapers > 0) {
        assessment += `• AI/ML papers: ${mlAiPapers}\n`;
      }
      
      assessment += `• Authority level: High (peer-reviewed preprints)\n\n`;
      
      return assessment;
    }
  
    private _isAcademicQuery(query: string): boolean {
      const academicIndicators = [
        'research', 'study', 'analysis', 'scientific', 'algorithm', 'method',
        'machine learning', 'ai', 'artificial intelligence', 'deep learning',
        'neural network', 'computer science', 'physics', 'mathematics',
        'quantum', 'cryptography', 'blockchain', 'paper', 'academic'
      ];
      
      const queryLower = query.toLowerCase();
      return academicIndicators.some(indicator => queryLower.includes(indicator));
    }
  
    private async _rateLimit(): Promise<void> {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      const waitTime = this.rateLimitDelay - timeSinceLastRequest;
      
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      this.lastRequestTime = Date.now();
    }
  }
  
  export function createArxivAgent(options: {
    speakerUri: string;
    serviceUrl: string;
    name?: string;
    organization?: string;
  }): ArxivAgent {
    const {
      speakerUri,
      serviceUrl,
      name = 'ArXiv Research Agent',
      organization = 'OpenFloor Research'
    } = options;
  
    const manifest: ManifestOptions = {
      identification: {
        speakerUri,
        serviceUrl,
        organization,
        conversationalName: name,
        synopsis: 'Academic research specialist for finding and analyzing scientific papers on arXiv'
      },
      capabilities: [
        {
          keyphrases: [
            'research', 'academic', 'papers', 'scientific', 'arxiv',
            'machine learning', 'ai', 'physics', 'mathematics', 'algorithm'
          ],
          descriptions: [
            'Search arXiv for academic papers and research publications',
            'Find scientific literature on machine learning, AI, physics, and mathematics',
            'Provide quality assessment of research papers and recent publications'
          ]
        }
      ]
    };
  
    return new ArxivAgent(manifest);
  }