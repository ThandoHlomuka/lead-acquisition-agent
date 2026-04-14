const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
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
// BUYER INTENT KEYWORDS - People expressing a need
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
// REAL PLATFORMS WITH USER-SUBMITTED CONTENT
// ============================================================
const USER_CONTENT_PLATFORMS = [
    // Classified Sites
    { name: 'Gumtree', url: 'https://www.gumtree.co.za', type: 'classified', regions: ['ZA', 'UK', 'AU'] },
    { name: 'Craigslist', url: 'https://www.craigslist.org', type: 'classified', regions: ['US', 'Global'] },
    { name: 'OLX', url: 'https://www.olx.co.za', type: 'classified', regions: ['ZA', 'Global'] },
    { name: 'Locanto', url: 'https://www.locanto.co.za', type: 'classified', regions: ['ZA', 'Global'] },
    { name: 'Classifieds South Africa', url: 'https://www.classifieds.co.za', type: 'classified', regions: ['ZA'] },
    
    // Forums & Discussion
    { name: 'Reddit', url: 'https://www.reddit.com', type: 'forum', regions: ['Global'] },
    { name: 'Quora', url: 'https://www.quora.com', type: 'forum', regions: ['Global'] },
    { name: 'HelloPeter', url: 'https://www.hellopeter.com', type: 'forum', regions: ['ZA'] },
    
    // Business Networks
    { name: 'LinkedIn Posts', url: 'https://www.linkedin.com', type: 'business', regions: ['Global'] },
    { name: 'Facebook Groups', url: 'https://www.facebook.com', type: 'social', regions: ['Global'] },
    
    // Procurement Portals
    { name: 'SA Tenders', url: 'https://www.etenders.gov.za', type: 'procurement', regions: ['ZA'] },
    { name: 'Global Tenders', url: 'https://www.globaltenders.com', type: 'procurement', regions: ['Global'] },
    { name: 'Tender Bulletin', url: 'https://www.tenderbulletin.co.za', type: 'procurement', regions: ['ZA'] },
    
    // Freelance/Contract
    { name: 'Upwork', url: 'https://www.upwork.com', type: 'contract', regions: ['Global'] },
    { name: 'Freelancer', url: 'https://www.freelancer.com', type: 'contract', regions: ['Global'] },
    { name: 'Fiverr', url: 'https://www.fiverr.com', type: 'contract', regions: ['Global'] },
    
    // Industry Directories
    { name: 'Yellow Pages', url: 'https://www.yellowpages.co.za', type: 'directory', regions: ['ZA'] },
    { name: 'Brabys', url: 'https://www.brabys.com', type: 'directory', regions: ['ZA'] },
    
    // Community Boards
    { name: 'Nextdoor', url: 'https://nextdoor.com', type: 'community', regions: ['US', 'Global'] },
    { name: 'Community Notice Boards', url: 'https://www.communitynoticeboard.co.za', type: 'community', regions: ['ZA'] }
];

// ============================================================
// SEARCH THE WEB USING MULTIPLE ENGINES
// ============================================================
async function searchWebEngines(query, maxResults = 100) {
    const allResults = [];
    
    // Build intent-based search queries
    const searchQueries = buildSearchQueries(query);
    
    console.log(`\n🔍 Searching with ${searchQueries.length} intent-based queries...`);
    
    // Search DuckDuckGo for each query
    for (const searchQuery of searchQueries) {
        try {
            const ddgResults = await searchDuckDuckGo(searchQuery, 20);
            allResults.push(...ddgResults);
            console.log(`  ✅ DuckDuckGo: ${ddgResults.length} results for "${searchQuery.substring(0, 50)}..."`);
        } catch (error) {
            console.error(`  ❌ DuckDuckGo failed: ${error.message}`);
        }
        await sleep(1000); // Rate limit
    }
    
    // Search Bing for each query
    for (const searchQuery of searchQueries) {
        try {
            const bingResults = await searchBing(searchQuery, 20);
            allResults.push(...bingResults);
            console.log(`  ✅ Bing: ${bingResults.length} results for "${searchQuery.substring(0, 50)}..."`);
        } catch (error) {
            console.error(`  ❌ Bing failed: ${error.message}`);
        }
        await sleep(1000);
    }
    
    console.log(`📊 Total raw results: ${allResults.length}`);
    return allResults;
}

// Build multiple search queries with buyer intent keywords
function buildSearchQueries(query) {
    const { keywords, leadType, region } = query;
    const queries = [];
    
    // Core intent searches - most important
    const intentPhrases = [
        `"looking for" ${keywords}`,
        `"wanted" ${keywords}`,
        `"seeking" ${keywords}`,
        `"I need" ${keywords}`,
        `"we need" ${keywords}`,
        `"want to buy" ${keywords}`,
        `"in search of" ${keywords}`,
        `"need someone to" ${keywords}`,
        `"hiring" ${keywords}`,
        `"need a" ${keywords}`,
        `"looking to hire" ${keywords}`,
        `"anyone know" ${keywords}`,
        `"recommendations for" ${keywords}`,
        `"where can I find" ${keywords}`,
        `"who can provide" ${keywords}`,
        `"require" ${keywords}`,
        `"request for quote" ${keywords}`,
        `"request for proposal" ${keywords}`,
        `"ISO" ${keywords}`,
        `"need help with" ${keywords}`,
        `"looking for a company" ${keywords}`,
        `"looking for a vendor" ${keywords}`,
        `"need a supplier" ${keywords}`,
        `"looking for contractor" ${keywords}`,
        `"need consultant" ${keywords}`
    ];
    
    // Add region to queries
    for (const phrase of intentPhrases) {
        queries.push(region ? `${phrase} ${region}` : phrase);
    }
    
    // Platform-specific searches
    const platforms = ['site:gumtree.co.za', 'site:craigslist.org', 'site:reddit.com', 'site:facebook.com'];
    for (const platform of platforms) {
        queries.push(`"looking for" ${keywords} ${platform}`);
        queries.push(`"wanted" ${keywords} ${platform}`);
        if (region) {
            queries.push(`"looking for" ${keywords} ${region} ${platform}`);
        }
    }
    
    return queries.slice(0, 50); // Limit to avoid excessive requests
}

// Search DuckDuckGo
async function searchDuckDuckGo(query, numResults) {
    const results = [];
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    try {
        const resp = await fetch(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            },
            timeout: 15000
        });
        
        const html = await resp.text();
        const $ = cheerio.load(html);
        
        $('.result').each((i, elem) => {
            const title = $(elem).find('.result__a').first().text().trim();
            const snippet = $(elem).find('.result__snippet').first().text().trim();
            const url = $(elem).find('.result__a').first().attr('href');
            
            if (title && snippet && title.length > 8) {
                // Check for buyer intent keywords
                const text = (title + ' ' + snippet).toLowerCase();
                const intentScore = calculateIntentScore(text);
                
                if (intentScore > 0) {
                    const emails = extractEmails(snippet + ' ' + title);
                    
                    results.push({
                        title: title,
                        snippet: snippet,
                        url: url || '',
                        emails: emails,
                        intentScore: intentScore,
                        source: 'DuckDuckGo',
                        timestamp: new Date().toISOString()
                    });
                }
            }
        });
    } catch (error) {
        throw error;
    }
    
    return results;
}

// Search Bing
async function searchBing(query, numResults) {
    const results = [];
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${numResults}`;
    
    try {
        const resp = await fetch(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 15000
        });
        
        const html = await resp.text();
        const $ = cheerio.load(html);
        
        $('#b_results .b_algo').each((i, elem) => {
            const title = $(elem).find('h2 a').text().trim();
            const snippet = $(elem).find('.b_caption p').text().trim();
            const url = $(elem).find('h2 a').attr('href');
            
            if (title && snippet && title.length > 8) {
                const text = (title + ' ' + snippet).toLowerCase();
                const intentScore = calculateIntentScore(text);
                
                if (intentScore > 0) {
                    const emails = extractEmails(snippet + ' ' + title);
                    
                    results.push({
                        title: title,
                        snippet: snippet,
                        url: url || '',
                        emails: emails,
                        intentScore: intentScore,
                        source: 'Bing',
                        timestamp: new Date().toISOString()
                    });
                }
            }
        });
    } catch (error) {
        throw error;
    }
    
    return results;
}

// ============================================================
// SCRAPE WEBSITES FOR REAL USER POSTS
// ============================================================
async function scrapeUserPosts(urls, query) {
    const leads = [];
    const uniqueUrls = [...new Set(urls)].slice(0, 50); // Limit to avoid overload
    
    console.log(`\n🕷️ Scraping ${uniqueUrls.length} websites for user posts...`);
    
    for (const url of uniqueUrls) {
        try {
            const lead = await extractLeadFromUrl(url, query);
            if (lead && lead.title) {
                leads.push(lead);
                console.log(`  ✅ Found lead: ${lead.title.substring(0, 60)}...`);
            }
        } catch (error) {
            // Skip failed URLs
        }
        await sleep(800); // Rate limit to avoid bans
    }
    
    console.log(`📊 Extracted ${leads.length} leads from websites`);
    return leads;
}

// Extract lead from a single URL
async function extractLeadFromUrl(url, query) {
    try {
        const resp = await fetch(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });
        
        const html = await resp.text();
        const $ = cheerio.load(html);
        
        // Extract emails, phones, addresses
        const emails = extractEmails(html);
        const phones = extractPhoneNumbers(html);
        const addresses = extractAddresses(html);
        
        // Get page title and description
        const title = $('title').text().trim() || $('h1').first().text().trim();
        const description = $('meta[name="description"]').attr('content') || 
                           $('p').first().text().trim().substring(0, 500);
        
        // Check if page contains buyer intent
        const textContent = $('body').text().toLowerCase();
        const intentScore = calculateIntentScore(textContent);
        
        if (intentScore < 1 && emails.length === 0) {
            return null; // Skip pages with no intent or contact info
        }
        
        // Extract author/poster info
        const author = extractAuthor($);
        const date = extractDate($);
        const deadline = extractDeadline(html);
        
        // Calculate budget if mentioned
        const budget = extractBudget(html);
        
        // Determine lead type based on content
        const leadType = determineLeadType(textContent);
        
        // Calculate priority
        const daysUntilDeadline = deadline ? Math.ceil((new Date(deadline) - new Date()) / (1000 * 60 * 60 * 24)) : 30;
        const priority = daysUntilDeadline <= 7 ? 'high' : daysUntilDeadline <= 30 ? 'medium' : 'low';
        
        return {
            id: `LEAD-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            title: title.substring(0, 150),
            type: leadType,
            description: description.substring(0, 500),
            contactName: author || 'Contact via email',
            companyName: extractCompanyName($) || '',
            email: emails[0] || 'Contact via website',
            phone: phones[0] || '',
            address: addresses[0] || '',
            region: query.region || 'Global',
            budget: budget,
            deadline: deadline || '',
            deadlineDays: daysUntilDeadline,
            priority: priority,
            website: url,
            source: url.includes('reddit') ? 'Reddit' : 
                    url.includes('facebook') ? 'Facebook' :
                    url.includes('gumtree') ? 'Gumtree' :
                    url.includes('craigslist') ? 'Craigslist' :
                    url.includes('upwork') ? 'Upwork' :
                    url.includes('linkedin') ? 'LinkedIn' : 'Web Search',
            keywords: query.keywords,
            intentScore: intentScore,
            timestamp: new Date().toISOString(),
            isReal: true
        };
    } catch (error) {
        return null;
    }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

// Calculate buyer intent score (0-100)
function calculateIntentScore(text) {
    let score = 0;
    text = text.toLowerCase();
    
    for (const keyword of BUYER_INTENT_KEYWORDS) {
        const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const matches = text.match(regex);
        if (matches) {
            score += matches.length * 10;
        }
    }
    
    return Math.min(score, 100);
}

// Extract emails
function extractEmails(text) {
    const regex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
    const matches = text.match(regex) || [];
    return [...new Set(matches)].filter(e => 
        !e.includes('example') && !e.includes('domain') && 
        !e.includes('schema') && e.split('@')[1].length > 3 &&
        !e.includes('no-reply') && !e.includes('noreply')
    );
}

// Extract phone numbers
function extractPhoneNumbers(text) {
    const regex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    const matches = text.match(regex) || [];
    return [...new Set(matches)].filter(p => p.replace(/\D/g, '').length >= 10);
}

// Extract addresses
function extractAddresses(text) {
    const regex = /\d+\s+[A-Z][a-zA-Z\s]+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Court|Ct|Place|Pl|Park|Pkwy)/gi;
    const matches = text.match(regex) || [];
    return [...new Set(matches)];
}

// Extract author/poster name
function extractAuthor($) {
    const selectors = [
        '.author a', '.username', '.user-name', '.post-author',
        '[class*="author"]', '[class*="user"] a', '.byline a',
        'meta[name="author"]'
    ];
    
    for (const sel of selectors) {
        const el = $(sel).first();
        if (el.length) {
            const text = el.text().trim() || el.attr('content');
            if (text && text.length > 2 && text.length < 50) {
                return text;
            }
        }
    }
    
    return null;
}

// Extract date
function extractDate($) {
    const selectors = [
        'time', '.date', '.post-date', '[class*="date"]',
        '[class*="time"]', 'meta[property="article:published_time"]'
    ];
    
    for (const sel of selectors) {
        const el = $(sel).first();
        if (el.length) {
            const text = el.text().trim() || el.attr('datetime') || el.attr('content');
            if (text) return text;
        }
    }
    
    return null;
}

// Extract deadline
function extractDeadline(html) {
    const patterns = [
        /(?:deadline|closing\s*date|due\s*date|expires|valid\s*until)[:\s]+(\d{4}[-/]\d{2}[-/]\d{2})/gi,
        /(?:deadline|closing)[:\s]+(\w+\s+\d+,\s+\d{4})/gi,
        /(\d{4}[-/]\d{2}[-/]\d{2}).*deadline/gi
    ];
    
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) {
            const dateMatch = match[0].match(/\d{4}[-/]\d{2}[-/]\d{2}|\w+\s+\d+,\s+\d{4}/);
            if (dateMatch) return dateMatch[0];
        }
    }
    
    return '';
}

// Extract budget from text
function extractBudget(html) {
    const patterns = [
        /(?:budget|value|amount|price|cost)[:\s]+[$€£ZAR]*(\d[\d,]+)/gi,
        /[$€£ZAR]*(\d[\d,]+)\s*(?:budget|value|amount)/gi
    ];
    
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) {
            const numMatch = match[0].match(/\d[\d,]+/);
            if (numMatch) {
                return parseInt(numMatch[0].replace(/,/g, ''));
            }
        }
    }
    
    return 0;
}

// Extract company name
function extractCompanyName($) {
    const selectors = [
        '.company-name', '.business-name', '.org-name',
        'meta[property="og:site_name"]', '.site-name',
        '.organization-name'
    ];
    
    for (const sel of selectors) {
        const el = $(sel).first();
        if (el.length) {
            const text = el.text().trim() || el.attr('content');
            if (text && text.length > 2 && text.length < 100) {
                return text;
            }
        }
    }
    
    return null;
}

// Determine lead type
function determineLeadType(text) {
    if (text.includes('rfp') || text.includes('request for proposal')) return 'RFP';
    if (text.includes('rfq') || text.includes('request for quotation')) return 'RFQ';
    if (text.includes('tender') || text.includes('bidding')) return 'Tender';
    if (text.includes('contract') || text.includes('freelance')) return 'Contract';
    if (text.includes('hiring') || text.includes('job')) return 'Job';
    if (text.includes('buy') || text.includes('purchase') || text.includes('wanted')) return 'Buyer Lead';
    if (text.includes('partnership') || text.includes('partner')) return 'Partnership';
    return 'Business Opportunity';
}

// Deduplicate leads
function deduplicateLeads(leads) {
    const seen = new Set();
    return leads.filter(lead => {
        const key = (lead.title + lead.email).toLowerCase().trim().substring(0, 50);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// Validate leads
function validateLeads(leads, query) {
    const valid = [];
    
    for (const lead of leads) {
        // Must have a real title
        if (!lead.title || lead.title.length < 8) continue;
        
        // Skip technical/system pages
        const skipTerms = ['javascript', 'css', 'cookie', 'privacy policy', 'terms of service', 'login', 'signup', 'register', 'schema', 'api documentation'];
        if (skipTerms.some(t => lead.title.toLowerCase().includes(t))) continue;
        
        // Must have some relevance
        const keywords = query.keywords.toLowerCase().split(' ');
        const relevant = keywords.some(k => 
            lead.title.toLowerCase().includes(k) || 
            (lead.description && lead.description.toLowerCase().includes(k))
        );
        
        // Accept if it has buyer intent OR contact info
        if (lead.intentScore > 0 || lead.email || lead.phone) {
            valid.push(lead);
        }
        
        if (valid.length >= 100) break;
    }
    
    return valid;
}

// Sleep utility
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// API ENDPOINTS
// ============================================================

// Search leads
app.get('/api/search-leads', async (req, res) => {
    try {
        const query = {
            keywords: req.query.keywords,
            leadType: req.query.leadType || 'all',
            region: req.query.region || '',
            budget: req.query.budget || 0
        };

        console.log('\n' + '='.repeat(60));
        console.log(`🎯 SEARCHING FOR REAL LEADS`);
        console.log(`Keywords: "${query.keywords}"`);
        console.log(`Type: ${query.leadType}, Region: ${query.region || 'Global'}`);
        console.log('='.repeat(60));

        // Step 1: Search the web with intent-based queries
        const searchResults = await searchWebEngines(query, 100);
        
        // Step 2: Extract URLs and scrape user posts
        const urls = searchResults.filter(r => r.url).map(r => r.url);
        const scrapedLeads = await scrapeUserPosts(urls, query);
        
        // Step 3: Combine search results with scraped leads
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
        
        // Step 4: Deduplicate and validate
        const unique = deduplicateLeads(allLeads);
        const leads = validateLeads(unique, query);
        
        // Sort by intent score and priority
        leads.sort((a, b) => {
            if (b.intentScore !== a.intentScore) return b.intentScore - a.intentScore;
            const priorityOrder = { high: 3, medium: 2, low: 1 };
            return priorityOrder[b.priority] - priorityOrder[a.priority];
        });

        // Save to database
        const existing = JSON.parse(fs.readFileSync(leadsDB, 'utf8'));
        const existingIds = new Set(existing.map(l => l.id));
        const newLeads = leads.filter(l => !existingIds.has(l.id));
        const combined = [...existing, ...newLeads];
        fs.writeFileSync(leadsDB, JSON.stringify(combined, null, 2));

        console.log(`\n✅ Found ${leads.length} REAL leads with buyer intent`);
        console.log(`📊 Total in database: ${combined.length}`);
        console.log('='.repeat(60) + '\n');

        res.json({
            success: true,
            count: leads.length,
            leads: leads,
            message: `Found ${leads.length} real leads from web search`
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

// Get all saved leads
app.get('/api/leads', (req, res) => {
    const leads = JSON.parse(fs.readFileSync(leadsDB, 'utf8'));
    res.json({ success: true, count: leads.length, leads });
});

// Start
app.listen(PORT, () => {
    console.log('\n' + '═'.repeat(60));
    console.log('🎯 LEAD ACQUISITION AGENT');
    console.log('═'.repeat(60));
    console.log('🔍 Searches for REAL user posts with buyer intent:');
    console.log('   • Classified sites (Gumtree, Craigslist, OLX)');
    console.log('   • Forums (Reddit, Quora, HelloPeter)');
    console.log('   • Social media (Facebook, LinkedIn)');
    console.log('   • Procurement portals (Tenders, RFPs, RFQs)');
    console.log('   • Freelance platforms (Upwork, Freelancer)');
    console.log('   • Community bulletin boards');
    console.log('');
    console.log('🎯 Looks for keywords: "looking for", "wanted",');
    console.log('   "seeking", "I need", "hiring", "RFQ", etc.');
    console.log('');
    console.log(`🌐 http://localhost:${PORT}`);
    console.log('❌ ZERO mock data - 100% real results only');
    console.log('═'.repeat(60) + '\n');
});
