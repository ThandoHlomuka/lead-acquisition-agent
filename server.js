const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3002;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Database
const leadsDB = path.join(__dirname, 'leads_db.json');
if (!fs.existsSync(leadsDB)) {
    fs.writeFileSync(leadsDB, JSON.stringify([]));
}

// ============================================================
// BUYER INTENT KEYWORDS
// ============================================================
const BUYER_INTENT_KEYWORDS = [
    "wanted", "looking for", "seeking", "I need", "we need",
    "want to buy", "in search of", "need someone to", "hiring",
    "request for quote", "request for proposal", "ISO",
    "need a", "looking to hire", "need to find", "seeking quotes",
    "anyone know", "recommendations for", "suggestions for",
    "where can I find", "who can provide", "who offers",
    "need help with", "looking for a company", "looking for a vendor",
    "need a supplier", "looking for contractor", "need consultant",
    "RFP", "RFQ", "tender", "bidding", "procurement",
    "purchase order", "buy", "purchasing", "acquire",
    "I want to", "we want to", "desperate for", "urgently need",
    "must have", "require", "requirement", "specifications for"
];

// ============================================================
// Search using multiple engines - FIXED VERSION
// ============================================================
async function searchEngines(query) {
    const allResults = [];
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    
    // Build search queries
    const queries = [
        `"looking for" ${query}`,
        `"wanted" ${query}`,
        `"I need" ${query}`,
        `"we need" ${query}`,
        `"seeking" ${query}`,
        `"need someone to" ${query}`,
        `"hiring" ${query}`,
        `"looking for a" ${query}`,
        `buy ${query} service`,
        `request quote ${query}`,
        `${query} procurement tender`,
        `${query} contractor supplier`
    ];

    console.log(`\n🔍 Running ${queries.length} search queries...`);

    // Search each query
    for (const q of queries) {
        // DuckDuckGo
        try {
            const {default: fetch} = await import('node-fetch');
            const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
            const resp = await fetch(url, {
                headers: { 'User-Agent': userAgent },
                timeout: 10000
            });
            
            if (resp.ok) {
                const html = await resp.text();
                const $ = cheerio.load(html);
                
                // Try multiple selectors
                const results = $('.result, .nrn-result, [class*="result"]');
                
                results.each((i, elem) => {
                    const title = $(elem).find('a').first().text().trim();
                    const snippet = $(elem).find('[class*="snippet"], p, .result__snippet').first().text().trim();
                    const href = $(elem).find('a').first().attr('href');
                    
                    if (title && title.length > 8) {
                        const text = (title + ' ' + snippet).toLowerCase();
                        const intentScore = calculateIntentScore(text);
                        
                        if (intentScore > 0) {
                            allResults.push({
                                title: title.substring(0, 150),
                                snippet: snippet.substring(0, 300),
                                url: href || '',
                                intentScore: intentScore,
                                source: 'DuckDuckGo',
                                timestamp: new Date().toISOString()
                            });
                        }
                    }
                });
                
                console.log(`  ✅ DDG: ${results.length} items for "${q.substring(0, 40)}..."`);
            }
        } catch (err) {
            console.log(`  ⚠️ DDG failed: ${err.message.substring(0, 50)}`);
        }
        
        await sleep(500);
    }

    console.log(`📊 Total results from search engines: ${allResults.length}\n`);
    return allResults;
}

// ============================================================
// SCRAPE WEBSITES FOR LEADS
// ============================================================
async function scrapeWebsites(urls, query) {
    const leads = [];
    const uniqueUrls = [...new Set(urls)].slice(0, 30);
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    
    console.log(`🕷️ Scraping ${uniqueUrls.length} websites...\n`);
    
    for (const url of uniqueUrls) {
        try {
            const {default: fetch} = await import('node-fetch');
            const resp = await fetch(url, {
                headers: { 'User-Agent': userAgent },
                timeout: 10000
            });
            
            if (resp.ok) {
                const html = await resp.text();
                const $ = cheerio.load(html);
                
                const emails = extractEmails(html);
                const phones = extractPhoneNumbers(html);
                const title = $('title').first().text().trim() || $('h1').first().text().trim();
                const description = $('meta[name="description"]').attr('content') || 
                                   $('p').first().text().trim().substring(0, 500);
                const text = $('body').text().toLowerCase();
                const intentScore = calculateIntentScore(text);
                
                // Accept if has intent OR contact info OR relevant title
                const relevant = title.toLowerCase().includes(query.keywords.toLowerCase()) ||
                               description.toLowerCase().includes(query.keywords.toLowerCase()) ||
                               intentScore > 0;
                
                if (relevant && title.length > 8) {
                    const deadline = extractDeadline(html);
                    const budget = extractBudget(html);
                    const daysUntil = deadline ? Math.ceil((new Date(deadline) - new Date()) / (1000 * 60 * 60 * 24)) : 30;
                    const priority = daysUntil <= 7 ? 'high' : daysUntil <= 30 ? 'medium' : 'low';
                    
                    leads.push({
                        id: `LEAD-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                        title: title.substring(0, 150),
                        type: determineLeadType(text),
                        description: description.substring(0, 500),
                        contactName: 'Contact via email/website',
                        companyName: '',
                        email: emails[0] || 'Contact via website',
                        phone: phones[0] || '',
                        region: query.region || 'Global',
                        budget: budget,
                        deadline: deadline || '',
                        deadlineDays: daysUntil,
                        priority: priority,
                        website: url,
                        source: extractDomain(url),
                        keywords: query.keywords,
                        intentScore: Math.max(intentScore, 10),
                        timestamp: new Date().toISOString(),
                        isReal: true
                    });
                    
                    console.log(`  ✅ Found: ${title.substring(0, 60)}...`);
                }
            }
        } catch (err) {
            // Skip failed URLs
        }
        await sleep(800);
    }
    
    console.log(`\n📊 Extracted ${leads.length} leads from websites\n`);
    return leads;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function calculateIntentScore(text) {
    let score = 0;
    for (const keyword of BUYER_INTENT_KEYWORDS) {
        const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const matches = text.match(regex);
        if (matches) score += matches.length * 10;
    }
    return Math.min(score, 100);
}

function extractEmails(text) {
    const regex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
    const matches = text.match(regex) || [];
    return [...new Set(matches)].filter(e => 
        !e.includes('example') && !e.includes('schema') && e.split('@')[1].length > 3
    );
}

function extractPhoneNumbers(text) {
    const regex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    const matches = text.match(regex) || [];
    return [...new Set(matches)].filter(p => p.replace(/\D/g, '').length >= 10);
}

function extractDeadline(html) {
    const match = html.match(/(?:deadline|closing|due|expires)[:\s]+(\d{4}[-/]\d{2}[-/]\d{2})/i);
    return match ? match[1] : '';
}

function extractBudget(html) {
    const match = html.match(/(?:budget|value|amount)[:\s]+[$€£]*(\d[\d,]+)/i);
    return match ? parseInt(match[1].replace(/,/g, '')) : 0;
}

function determineLeadType(text) {
    if (text.includes('rfp') || text.includes('request for proposal')) return 'RFP';
    if (text.includes('rfq') || text.includes('request for quotation')) return 'RFQ';
    if (text.includes('tender') || text.includes('bidding')) return 'Tender';
    if (text.includes('contract') || text.includes('freelance')) return 'Contract';
    if (text.includes('hiring') || text.includes('job')) return 'Job';
    if (text.includes('buy') || text.includes('purchase') || text.includes('wanted')) return 'Buyer Lead';
    return 'Business Opportunity';
}

function extractDomain(url) {
    try {
        return new URL(url).hostname.replace('www.', '');
    } catch {
        return 'Web Search';
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function deduplicateLeads(leads) {
    const seen = new Set();
    return leads.filter(lead => {
        const key = (lead.title + lead.email).toLowerCase().trim().substring(0, 50);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ============================================================
// API ENDPOINTS
// ============================================================

app.get('/api/search-leads', async (req, res) => {
    try {
        const query = {
            keywords: req.query.keywords,
            leadType: req.query.leadType || 'all',
            region: req.query.region || ''
        };

        console.log('\n' + '='.repeat(60));
        console.log(`🎯 SEARCHING FOR: "${query.keywords}"`);
        console.log('='.repeat(60));

        // Step 1: Search engines
        const searchResults = await searchEngines(query.keywords);
        
        // Step 2: Scrape websites from search results
        const urls = searchResults.filter(r => r.url).map(r => r.url);
        const scrapedLeads = await scrapeWebsites(urls, query);
        
        // Step 3: Combine all leads
        const allLeads = [
            ...searchResults.map(r => ({
                id: `LEAD-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                title: r.title,
                type: 'Opportunity',
                description: r.snippet,
                contactName: 'Contact via website',
                companyName: '',
                email: 'Contact via website',
                phone: '',
                region: query.region || 'Global',
                budget: 0,
                deadline: '',
                deadlineDays: 30,
                priority: r.intentScore > 50 ? 'high' : r.intentScore > 20 ? 'medium' : 'low',
                website: r.url,
                source: r.source,
                keywords: query.keywords,
                intentScore: r.intentScore,
                timestamp: new Date().toISOString(),
                isReal: true
            })),
            ...scrapedLeads
        ];
        
        // Step 4: Deduplicate
        const unique = deduplicateLeads(allLeads);
        
        // Sort by intent score
        unique.sort((a, b) => b.intentScore - a.intentScore);

        // Save to database
        const existing = JSON.parse(fs.readFileSync(leadsDB, 'utf8'));
        const existingIds = new Set(existing.map(l => l.id));
        const newLeads = unique.filter(l => !existingIds.has(l.id));
        const combined = [...existing, ...newLeads];
        fs.writeFileSync(leadsDB, JSON.stringify(combined, null, 2));

        console.log(`\n✅ Found ${unique.length} leads`);
        console.log(`📊 Total in database: ${combined.length}\n`);

        res.json({
            success: true,
            count: unique.length,
            leads: unique,
            message: `Found ${unique.length} leads from web search`
        });
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            leads: [],
            message: 'Error searching for leads'
        });
    }
});

app.get('/api/leads', (req, res) => {
    try {
        const leads = JSON.parse(fs.readFileSync(leadsDB, 'utf8'));
        res.json({ success: true, count: leads.length, leads });
    } catch (error) {
        res.json({ success: true, count: 0, leads: [] });
    }
});

// Start
app.listen(PORT, () => {
    console.log('\n' + '═'.repeat(60));
    console.log('🎯 LEAD ACQUISITION AGENT');
    console.log('═'.repeat(60));
    console.log(`🌐 http://localhost:${PORT}`);
    console.log('🔍 Searching web for REAL leads');
    console.log('═'.repeat(60) + '\n');
});
