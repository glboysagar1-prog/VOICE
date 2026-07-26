const axios = require('axios');
const cheerio = require('cheerio');
const MiniSearch = require('minisearch');

// Query self-hosted SearXNG instance
async function querySearXNG(query) {
  const host = process.env.SEARXNG_URL || 'http://localhost:8080';
  console.log(`[Search] Querying SearXNG at ${host} for "${query}"...`);
  
  try {
    const response = await axios.get(`${host}/search`, {
      params: { q: query, format: 'json', engines: 'google,bing,duckduckgo' }
    });
    // Return top 3 URLs
    if (response.data && response.data.results) {
      return response.data.results.slice(0, 3).map(r => r.url);
    }
    return [];
  } catch (err) {
    console.error('[Search Error] SearXNG query failed:', err.message);
    return [];
  }
}

// Scrape page content using Axios + Cheerio
async function scrapePageContent(url) {
  try {
    console.log(`[Scraper] Fetching page: ${url}`);
    const response = await axios.get(url, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36' 
      },
      timeout: 4000
    });
    const $ = cheerio.load(response.data);
    
    // Remove scripts, styles, navigation, footer, header to isolate core content
    $('script, style, nav, footer, iframe, noscript, header, aside, .footer, .header, #footer, #header').remove();
    
    const paragraphs = [];
    $('p').each((i, el) => {
      const txt = $(el).text().trim();
      // Only keep paragraphs that are longer than 40 characters to avoid extraction of single words or button labels
      if (txt.length > 40) {
        paragraphs.push(txt);
      }
    });
    return paragraphs;
  } catch (err) {
    console.warn(`[Scraper Warning] Failed to scrape ${url}:`, err.message);
    return [];
  }
}

// Run local BM25 ranking on paragraphs using MiniSearch
function rankParagraphsBM25(paragraphs, query) {
  if (paragraphs.length === 0) return [];
  
  const miniSearch = new MiniSearch({
    fields: ['text'],
    storeFields: ['text']
  });
  
  const documents = paragraphs.map((p, i) => ({ id: i, text: p }));
  miniSearch.addAll(documents);
  
  const results = miniSearch.search(query);
  console.log(`[BM25 Ranker] Scored ${paragraphs.length} paragraphs. Found ${results.length} relevance matches.`);
  return results.slice(0, 5).map(r => r.text);
}

// Full Search Orchestrator Orchestration Loop
async function searchWebAndRank(query) {
  const urls = await querySearXNG(query);
  if (urls.length === 0) return "";
  
  const allParagraphs = [];
  for (const url of urls) {
    const paragraphs = await scrapePageContent(url);
    if (paragraphs.length > 0) {
      allParagraphs.push(...paragraphs);
    }
  }
  
  const topParagraphs = rankParagraphsBM25(allParagraphs, query);
  return topParagraphs.join("\n\n");
}

module.exports = { searchWebAndRank, querySearXNG, scrapePageContent, rankParagraphsBM25 };
