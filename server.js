const express = require('express');
const cors = require('cors');
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
// SOUTH AFRICAN SPECIFIC SOURCES
// ============================================================
const SA_SOURCES = {
    classifieds: [
        'site:gumtree.co.za',
        'site:olx.co.za',
        'site:junkmail.co.za',
        'site:locanto.co.za',
        'site:classifieds.co.za',
        'site:bidorbuy.co.za'
    ],
    tenders: [
        'site:etenders.gov.za',
        'site:tenderbulletin.co.za',
        'site:satenders.net',
        'site:online-tenders.com',
        'site:tendersa.co.za',
        'site:national.gov.za'
    ],
    forums: [
        'site:hellopeter.com',
        'site:reddit.com/r/southafrica',
        'site:mybroadband.co.za',
        'site:techcentral.co.za'
    ],
    jobs: [
        'site:careerjunction.co.za',
        'site:indeed.co.za',
        'site:pnet.co.za',
        'site:careers24.com',
        'site:jobplacements.com'
    ],
    business: [
        'site:linkedin.com',
        'site:facebook.com',
        'site:yellowpages.co.za',
        'site:brabys.com',
        'site:topsa.co.za'
    ],
    remote: [
        'site:upwork.com "South Africa"',
        'site:freelancer.com "South Africa"',
        'site:remote.co "South Africa"',
        'site:weworkremotely.com "South Africa"',
        'site:angel.co "South Africa"',
        'site:toptal.com "South Africa"',
        '"South Africa" remote work',
        '"South Africans" remote jobs'
    ]
};

// ============================================================
// GOOGLE SEARCH (Primary)
// ============================================================
async function searchGoogle(query, maxResults = 20) {
    const results = [];
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    
    try {
        // Use Google search via public URL
        const url = `https://www.google.co.za/search?q=${encodeURIComponent(query)}&num=${maxResults}&hl=en`;
        
        const { default: nodeFetch } = await import('node-fetch');
        const resp = await nodeFetch(url, {
            headers: { 
                'User-Agent': userAgent,
                'Accept-Language': 'en-ZA,en-US;q=0.9,en;q=0.8'
            },
            timeout: 15000,
            redirect: 'follow'
        });
        
        if (resp.ok) {
            const html = await resp.text();
            const $ = cheerio.load(html);
            
            // Google search result selectors (updated for 2024/2025)
            const selectors = [
                'div.g',
                'div[data-sokoban-feature="true"]',
                '.tF2Cxc',
                '.yuRUbf',
                'div.MjjYud'
            ];
            
            let items = $();
            for (const sel of selectors) {
                items = $(sel);
                if (items.length > 0) break;
            }
            
            items.each((i, elem) => {
                const titleEl = $(elem).find('h3, [role="heading"]').first();
                const linkEl = $(elem).find('a').first();
                const snippetEl = $(elem).find('[data-sncf], .VwiC3b, .yXK7lf, [style*="-webkit-line-clamp"]');
                
                const title = titleEl.text().trim();
                const url = linkEl.attr('href') || '';
                const snippet = snippetEl.text().trim();
                
                if (title && title.length > 8) {
                    // Clean Google redirect URLs
                    let cleanUrl = url;
                    if (url.includes('/url?')) {
                        const match = url.match(/url=([^&]+)/);
                        cleanUrl = match ? decodeURIComponent(match[1]) : url;
                    }
                    
                    const text = (title + ' ' + snippet).toLowerCase();
                    const intentScore = calculateIntentScore(text);
                    const isSA = isSouthAfrican(text, cleanUrl);
                    
                    if (intentScore > 0 || isSA) {
                        const emails = extractEmails(snippet + ' ' + title);
                        
                        results.push({
                            title: title.substring(0, 200),
                            snippet: snippet.substring(0, 400),
                            url: cleanUrl,
                            emails: emails,
                            intentScore: intentScore,
                            isSouthAfrican: isSA,
                            source: 'Google.co.za',
                            timestamp: new Date().toISOString()
                        });
                    }
                }
            });
            
            console.log(`  ✅ Google: ${results.length} results for "${query.substring(0, 60)}..."`);
        }
    } catch (error) {
        console.log(`  ⚠️ Google search failed: ${error.message.substring(0, 80)}`);
    }
    
    return results;
}

// ============================================================
// DUCKDUCKGO SEARCH (Secondary)
// ============================================================
async function searchDuckDuckGo(query, maxResults = 20) {
    const results = [];
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    
    try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        
        const { default: nodeFetch } = await import('node-fetch');
        const resp = await nodeFetch(url, {
            headers: { 'User-Agent': userAgent },
            timeout: 15000
        });
        
        if (resp.ok) {
            const html = await resp.text();
            const $ = cheerio.load(html);
            
            $('.result').each((i, elem) => {
                const title = $(elem).find('.result__a').first().text().trim();
                const snippet = $(elem).find('.result__snippet').first().text().trim();
                const url = $(elem).find('.result__a').first().attr('href') || '';
                
                if (title && title.length > 8) {
                    const text = (title + ' ' + snippet).toLowerCase();
                    const intentScore = calculateIntentScore(text);
                    const isSA = isSouthAfrican(text, url);
                    
                    if (intentScore > 0 || isSA) {
                        const emails = extractEmails(snippet + ' ' + title);
                        
                        results.push({
                            title: title.substring(0, 200),
                            snippet: snippet.substring(0, 400),
                            url: url,
                            emails: emails,
                            intentScore: intentScore,
                            isSouthAfrican: isSA,
                            source: 'DuckDuckGo',
                            timestamp: new Date().toISOString()
                        });
                    }
                }
            });
            
            console.log(`  ✅ DuckDuckGo: ${results.length} results for "${query.substring(0, 60)}..."`);
        }
    } catch (error) {
        console.log(`  ⚠️ DuckDuckGo failed: ${error.message.substring(0, 80)}`);
    }
    
    return results;
}

// ============================================================
// BING SEARCH (Tertiary)
// ============================================================
async function searchBing(query, maxResults = 20) {
    const results = [];
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    
    try {
        const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
        
        const { default: nodeFetch } = await import('node-fetch');
        const resp = await nodeFetch(url, {
            headers: { 'User-Agent': userAgent },
            timeout: 15000
        });
        
        if (resp.ok) {
            const html = await resp.text();
            const $ = cheerio.load(html);
            
            $('#b_results .b_algo').each((i, elem) => {
                const title = $(elem).find('h2 a').text().trim();
                const snippet = $(elem).find('.b_caption p').text().trim();
                const url = $(elem).find('h2 a').attr('href') || '';
                
                if (title && title.length > 8) {
                    const text = (title + ' ' + snippet).toLowerCase();
                    const intentScore = calculateIntentScore(text);
                    const isSA = isSouthAfrican(text, url);
                    
                    if (intentScore > 0 || isSA) {
                        const emails = extractEmails(snippet + ' ' + title);
                        
                        results.push({
                            title: title.substring(0, 200),
                            snippet: snippet.substring(0, 400),
                            url: url,
                            emails: emails,
                            intentScore: intentScore,
                            isSouthAfrican: isSA,
                            source: 'Bing',
                            timestamp: new Date().toISOString()
                        });
                    }
                }
            });
            
            console.log(`  ✅ Bing: ${results.length} results for "${query.substring(0, 60)}..."`);
        }
    } catch (error) {
        console.log(`  ⚠️ Bing failed: ${error.message.substring(0, 80)}`);
    }
    
    return results;
}

// ============================================================
// CHECK IF RESULT IS SOUTH AFRICAN
// ============================================================
function isSouthAfrican(text, url) {
    const saIndicators = [
        'south africa', 'south african', 'sa ', '.co.za', 'za ',
        'johannesburg', 'cape town', 'durban', 'pretoria', 'gauteng',
        'kwazulu-natal', 'western cape', 'eastern cape', 'limpopo',
        'mpumalanga', 'north west', 'free state', 'northern cape',
        'sandton', 'midrand', 'centurion', 'roodepoort', 'boksburg',
        'stellenbosch', 'somerset west', 'paarl', 'bloemfontein',
        'port elizabeth', 'gqeberha', 'east london', 'polokwane',
        'nelspruit', 'kimberley', 'pietermaritzburg', 'rustenburg'
    ];
    
    const combined = (text + ' ' + url).toLowerCase();
    return saIndicators.some(indicator => combined.includes(indicator));
}

// ============================================================
// BUILD SA-SPECIFIC SEARCH QUERIES
// ============================================================
function buildSAQueries(keywords, leadType) {
    const queries = [];
    const kw = keywords;
    
    // ==========================================
    // PRIMARY: Google-optimized SA searches
    // ==========================================
    
    // Direct buyer intent searches (most important)
    queries.push(`"looking for" ${kw} South Africa`);
    queries.push(`"wanted" ${kw} South Africa`);
    queries.push(`"I need" ${kw} South Africa`);
    queries.push(`"we need" ${kw} South Africa`);
    queries.push(`"seeking" ${kw} South Africa`);
    queries.push(`"need someone to" ${kw} South Africa`);
    queries.push(`"hiring" ${kw} South Africa`);
    queries.push(`"request for quote" ${kw} South Africa`);
    queries.push(`"request for proposal" ${kw} South Africa`);
    
    // Classifieds searches
    queries.push(`"looking for" ${kw} site:gumtree.co.za`);
    queries.push(`"wanted" ${kw} site:gumtree.co.za`);
    queries.push(`"looking for" ${kw} site:olx.co.za`);
    queries.push(`"wanted" ${kw} site:olx.co.za`);
    queries.push(`"looking for" ${kw} site:junkmail.co.za`);
    queries.push(`"needed" ${kw} site:gumtree.co.za`);
    
    // Tender/procurement searches
    queries.push(`${kw} tender site:etenders.gov.za`);
    queries.push(`${kw} tender site:tenderbulletin.co.za`);
    queries.push(`${kw} RFP site:etenders.gov.za`);
    queries.push(`${kw} RFQ site:etenders.gov.za`);
    queries.push(`"request for proposal" ${kw} South Africa`);
    queries.push(`"request for quotation" ${kw} South Africa`);
    
    // Business/contractor searches
    queries.push(`"looking for a" ${kw} South Africa`);
    queries.push(`"looking for contractor" ${kw} South Africa`);
    queries.push(`"need a supplier" ${kw} South Africa`);
    queries.push(`"looking for vendor" ${kw} South Africa`);
    queries.push(`"need consultant" ${kw} South Africa`);
    
    // Remote work that accepts South Africans
    queries.push(`remote ${kw} "South Africa" OR "South Africans"`);
    queries.push(`"South Africa" remote ${kw} jobs`);
    queries.push(`"accepting South Africans" ${kw}`);
    queries.push(`"South Africans welcome" ${kw} remote`);
    queries.push(`remote ${kw} "work from anywhere" "South Africa"`);
    queries.push(`"South Africa" ${kw} freelance remote`);
    
    // Forum/community requests
    queries.push(`"looking for" ${kw} site:reddit.com/r/southafrica`);
    queries.push(`"need" ${kw} site:hellopeter.com`);
    queries.push(`"recommend" ${kw} South Africa`);
    queries.push(`"anyone know" ${kw} South Africa`);
    
    // Industry-specific
    if (leadType === 'tender' || leadType === 'all') {
        queries.push(`${kw} tender procurement South Africa 2024 2025`);
        queries.push(`${kw} bid opportunity South Africa`);
    }
    
    if (leadType === 'contract' || leadType === 'all') {
        queries.push(`${kw} contract South Africa`);
        queries.push(`${kw} freelance South Africa`);
    }
    
    if (leadType === 'wanted' || leadType === 'all') {
        queries.push(`"want to buy" ${kw} South Africa`);
        queries.push(`"in search of" ${kw} South Africa`);
    }
    
    return queries;
}

// ============================================================
// MAIN SEARCH FUNCTION
// ============================================================
async function searchForLeads(keywords, leadType = 'all') {
    const allResults = [];
    const queries = buildSAQueries(keywords, leadType);
    
    console.log(`\n🔍 Running ${queries.length} SA-optimized search queries...\n`);
    
    // STEP 1: Google searches (Primary - run first for all queries)
    console.log('📍 Step 1: Searching Google.co.za (Primary)...');
    for (let i = 0; i < queries.length; i++) {
        const query = queries[i];
        const googleResults = await searchGoogle(query, 15);
        allResults.push(...googleResults);
        
        // Progress indicator
        if ((i + 1) % 10 === 0 || i === queries.length - 1) {
            console.log(`   Progress: ${i + 1}/${queries.length} queries (${allResults.length} results so far)`);
        }
        
        await sleep(800 + Math.random() * 1000); // Avoid Google rate limiting
    }
    
    // STEP 2: DuckDuckGo (Secondary - for backup)
    console.log('\n📍 Step 2: Searching DuckDuckGo (Secondary)...');
    const secondaryQueries = queries.slice(0, 15); // First 15 most important
    for (let i = 0; i < secondaryQueries.length; i++) {
        const query = secondaryQueries[i];
        const ddgResults = await searchDuckDuckGo(query, 15);
        allResults.push(...ddgResults);
        
        await sleep(500);
    }
    
    // STEP 3: Bing (Tertiary - for additional coverage)
    console.log('\n📍 Step 3: Searching Bing (Tertiary)...');
    const tertiaryQueries = queries.slice(0, 10); // First 10
    for (let i = 0; i < tertiaryQueries.length; i++) {
        const query = tertiaryQueries[i];
        const bingResults = await searchBing(query, 15);
        allResults.push(...bingResults);
        
        await sleep(500);
    }
    
    console.log(`\n📊 Total raw results: ${allResults.length}`);
    console.log(`   South African results: ${allResults.filter(r => r.isSouthAfrican).length}`);
    console.log(`   High intent results: ${allResults.filter(r => r.intentScore > 30).length}\n`);
    
    return allResults;
}

// ============================================================
// SCRAPE WEBSITES FOR CONTACT INFO
// ============================================================
async function scrapeWebsites(urls, query) {
    const leads = [];
    const uniqueUrls = [...new Set(urls)].slice(0, 40);
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    
    console.log(`🕷️ Scraping ${uniqueUrls.length} websites for contact info...\n`);
    
    for (const url of uniqueUrls) {
        try {
            const { default: nodeFetch } = await import('node-fetch');
            const resp = await nodeFetch(url, {
                headers: { 'User-Agent': userAgent },
                timeout: 10000,
                redirect: 'follow'
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
                const isSA = isSouthAfrican(text, url);
                
                // Accept if SA-related OR has intent OR has contact info
                const relevant = isSA || 
                               intentScore > 0 || 
                               emails.length > 0 ||
                               title.toLowerCase().includes(query.keywords.toLowerCase());
                
                if (relevant && title.length > 8) {
                    const deadline = extractDeadline(html);
                    const budget = extractBudget(html);
                    const daysUntil = deadline ? Math.ceil((new Date(deadline) - new Date()) / (1000 * 60 * 60 * 24)) : 30;
                    const priority = daysUntil <= 7 ? 'high' : daysUntil <= 30 ? 'medium' : 'low';
                    
                    leads.push({
                        id: `LEAD-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                        title: title.substring(0, 200),
                        type: determineLeadType(text),
                        description: description.substring(0, 500),
                        contactName: 'Contact via email/website',
                        companyName: '',
                        email: emails[0] || 'Contact via website',
                        phone: phones[0] || '',
                        region: isSA ? 'South Africa' : (query.region || 'Remote/International'),
                        budget: budget,
                        deadline: deadline || '',
                        deadlineDays: daysUntil,
                        priority: priority,
                        website: url,
                        source: extractDomain(url),
                        keywords: query.keywords,
                        intentScore: Math.max(intentScore, isSA ? 20 : 10),
                        isSouthAfrican: isSA,
                        timestamp: new Date().toISOString(),
                        isReal: true
                    });
                    
                    console.log(`  ✅ Found: ${title.substring(0, 70)}...`);
                }
            }
        } catch (err) {
            // Skip failed URLs
        }
        await sleep(600);
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
    const saRegex = /(?:\+27|0)[\s-]?(?:1[0-8]|[2-8][0-9]|9[0-8])[\s-]?\d{3}[\s-]?\d{4}/g;
    const matches = [...(text.match(regex) || []), ...(text.match(saRegex) || [])];
    return [...new Set(matches)].filter(p => p.replace(/\D/g, '').length >= 10);
}

function extractDeadline(html) {
    const patterns = [
        /(?:deadline|closing|due|expires|closing date)[:\s]+(\d{4}[-/]\d{2}[-/]\d{2})/gi,
        /(\d{4}[-/]\d{2}[-/]\d{2}).*deadline/gi,
        /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/gi
    ];
    
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) {
            const dateMatch = match[0].match(/\d{4}[-/]\d{2}[-/]\d{2}|\d{1,2}\s+\w+\s+\d{4}/);
            if (dateMatch) return dateMatch[0];
        }
    }
    return '';
}

function extractBudget(html) {
    const patterns = [
        /(?:budget|value|amount|estimated|contract value)[:\s]+[R$€£]*(\d[\d,]+)/gi,
        /[R](\d[\d,]+)\s*(?:budget|value|amount)/gi
    ];
    
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) {
            const numMatch = match[0].match(/[\d,]+/);
            if (numMatch) return parseInt(numMatch[0].replace(/,/g, ''));
        }
    }
    return 0;
}

function determineLeadType(text) {
    if (text.includes('rfp') || text.includes('request for proposal')) return 'RFP';
    if (text.includes('rfq') || text.includes('request for quotation')) return 'RFQ';
    if (text.includes('tender') || text.includes('bidding')) return 'Tender';
    if (text.includes('contract') || text.includes('freelance')) return 'Contract';
    if (text.includes('hiring') || text.includes('job')) return 'Job/Hiring';
    if (text.includes('buy') || text.includes('purchase') || text.includes('wanted')) return 'Buyer Lead';
    if (text.includes('remote') && text.includes('south africa')) return 'Remote (SA-friendly)';
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
        const key = (lead.title + lead.website).toLowerCase().trim().substring(0, 60);
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
            region: 'South Africa' // Default to SA
        };

        console.log('\n' + '═'.repeat(70));
        console.log(`🇿🇦 SOUTH AFRICA LEAD ACQUISITION AGENT`);
        console.log('═'.repeat(70));
        console.log(`🔍 Searching for: "${query.keywords}"`);
        console.log(`📍 Focus: South Africa + Remote (SA-friendly)`);
        console.log(`📊 Type: ${query.leadType}`);
        console.log('═'.repeat(70) + '\n');

        // Step 1: Search engines (Google -> DuckDuckGo -> Bing)
        const searchResults = await searchForLeads(query.keywords, query.leadType);
        
        // Step 2: Scrape websites for more details
        const urls = searchResults
            .filter(r => r.url && r.url.startsWith('http'))
            .map(r => r.url);
        const scrapedLeads = await scrapeWebsites(urls, query);
        
        // Step 3: Combine all leads
        const allLeads = [
            ...searchResults.map(r => ({
                id: `LEAD-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                title: r.title,
                type: determineLeadType((r.title + ' ' + r.snippet).toLowerCase()),
                description: r.snippet,
                contactName: 'Contact via website',
                companyName: '',
                email: r.emails[0] || 'Contact via website',
                phone: '',
                region: r.isSouthAfrican ? 'South Africa' : 'Remote/International',
                budget: 0,
                deadline: '',
                deadlineDays: 30,
                priority: r.intentScore > 50 ? 'high' : r.intentScore > 20 ? 'medium' : 'low',
                website: r.url,
                source: r.source,
                keywords: query.keywords,
                intentScore: r.intentScore,
                isSouthAfrican: r.isSouthAfrican,
                timestamp: new Date().toISOString(),
                isReal: true
            })),
            ...scrapedLeads
        ];
        
        // Step 4: Deduplicate
        const unique = deduplicateLeads(allLeads);
        
        // Sort: SA first, then by intent score
        unique.sort((a, b) => {
            if (a.isSouthAfrican !== b.isSouthAfrican) return b.isSouthAfrican - a.isSouthAfrican;
            return b.intentScore - a.intentScore;
        });

        // Save to database
        const existing = JSON.parse(fs.readFileSync(leadsDB, 'utf8'));
        const existingIds = new Set(existing.map(l => l.id));
        const newLeads = unique.filter(l => !existingIds.has(l.id));
        const combined = [...existing, ...newLeads];
        fs.writeFileSync(leadsDB, JSON.stringify(combined, null, 2));

        const saCount = unique.filter(l => l.isSouthAfrican).length;
        console.log('\n' + '═'.repeat(70));
        console.log(`✅ Found ${unique.length} leads`);
        console.log(`🇿🇦 South African leads: ${saCount}`);
        console.log(`🌍 Remote/International: ${unique.length - saCount}`);
        console.log(`📊 Total in database: ${combined.length}`);
        console.log('═'.repeat(70) + '\n');

        res.json({
            success: true,
            count: unique.length,
            southAfricanCount: saCount,
            leads: unique,
            message: `Found ${unique.length} leads (${saCount} SA, ${unique.length - saCount} Remote/International)`
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
    console.log('\n' + '═'.repeat(70));
    console.log('🇿🇦 SOUTH AFRICA LEAD ACQUISITION AGENT');
    console.log('═'.repeat(70));
    console.log('🔍 PRIMARY SEARCH ENGINE: Google.co.za');
    console.log('📍 FOCUS: South Africa + Remote (SA-friendly)');
    console.log('');
    console.log('📊 Searches:');
    console.log('  ✓ SA Classifieds (Gumtree, OLX, Junk Mail)');
    console.log('  ✓ SA Tenders (eTenders, Tender Bulletin)');
    console.log('  ✓ SA Forums (HelloPeter, MyBroadband)');
    console.log('  ✓ SA Jobs (CareerJunction, PNet, Indeed SA)');
    console.log('  ✓ Remote work accepting South Africans');
    console.log('');
    console.log('🎯 Buyer Intent Keywords:');
    console.log('  "looking for", "wanted", "I need", "seeking",');
    console.log('  "hiring", "RFP", "RFQ", "tender", etc.');
    console.log('');
    console.log(`🌐 http://localhost:${PORT}`);
    console.log('═'.repeat(70) + '\n');
});
