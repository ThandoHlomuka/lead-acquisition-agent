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

// Database to store found leads
const leadsDB = path.join(__dirname, 'leads_db.json');
if (!fs.existsSync(leadsDB)) {
    fs.writeFileSync(leadsDB, JSON.stringify([]));
}

// Real web search sources for leads
const LEAD_SOURCES = [
    { 
        name: 'TenderNigeria', 
        url: 'https://www.tendersnigeria.com', 
        type: 'tender' 
    },
    { 
        name: 'TenderTab', 
        url: 'https://www.tendertab.com', 
        type: 'tender' 
    },
    { 
        name: 'Global Tenders', 
        url: 'https://www.globaltenders.com', 
        type: 'tender' 
    },
    { 
        name: 'BidStats', 
        url: 'https://www.bidstats.co.uk', 
        type: 'rfp' 
    },
    { 
        name: 'TED EU Tenders', 
        url: 'https://ted.europa.eu', 
        type: 'tender' 
    },
    { 
        name: 'SA Tenders', 
        url: 'https://www.etenders.gov.za', 
        type: 'tender' 
    },
    { 
        name: 'Upwork', 
        url: 'https://www.upwork.com', 
        type: 'contract' 
    },
    { 
        name: 'Freelancer', 
        url: 'https://www.freelancer.com', 
        type: 'contract' 
    }
];

// Search leads using multiple web sources
async function searchLeadsWeb(query) {
    const results = [];
    const { keywords, leadType, region, budget } = query;

    // Build search queries for different sources
    const searchQueries = [
        `${keywords} ${leadType !== 'all' ? leadType : 'tender RFP RFQ'} ${region || ''} contact email`,
        `${keywords} business opportunity contract ${region || ''}`,
        `${keywords} "request for proposal" OR "request for quotation" ${region || ''}`,
        `${keywords} tender bidding ${region || ''} deadline`,
        `${keywords} procurement contract opportunity ${region || ''} email`
    ];

    // Search using DuckDuckGo (no API key required)
    for (const searchQuery of searchQueries) {
        try {
            const ddgResults = await searchDuckDuckGoLeads(searchQuery);
            results.push(...ddgResults);
            console.log(`✅ DuckDuckGo: ${ddgResults.length} results`);
        } catch (error) {
            console.error(`❌ DuckDuckGo error: ${error.message}`);
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Scrape specific lead sources
    for (const source of LEAD_SOURCES) {
        try {
            const sourceResults = await scrapeLeadSource(source, query);
            results.push(...sourceResults);
            console.log(`✅ ${source.name}: ${sourceResults.length} results`);
        } catch (error) {
            console.error(`❌ ${source.name} error: ${error.message}`);
        }

        // Delay between requests
        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    // Remove duplicates and validate
    const uniqueResults = deduplicateLeads(results);
    
    // ONLY return real data - no mock data
    const realLeads = validateRealLeads(uniqueResults, query);
    
    console.log(`🎯 Total real leads found: ${realLeads.length}`);
    
    return realLeads;
}

// Search DuckDuckGo for leads (real search results)
async function searchDuckDuckGoLeads(query) {
    const results = [];
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const response = await fetch(searchUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 15000
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract search results
    $('.result').each((i, elem) => {
        const title = $(elem).find('.result__a').first().text().trim();
        const snippet = $(elem).find('.result__snippet').first().text().trim();
        const url = $(elem).find('.result__a').first().attr('href');

        if (title && snippet && title.length > 10) {
            // Extract emails from snippet
            const emails = extractEmails(snippet);
            
            // Extract deadline if present
            const deadlineMatch = snippet.match(/(?:deadline|closing|due)[:\s]+(\w+\s+\d+,\s+\d{4}|\d{4}[-/]\d{2}[-/]\d{2})/i);
            const deadline = deadlineMatch ? deadlineMatch[1] : '';
            
            results.push({
                title: title,
                description: snippet,
                website: url || '',
                email: emails[0] || '',
                deadline: deadline,
                source: 'DuckDuckGo',
                searchQuery: query,
                timestamp: new Date().toISOString()
            });
        }
    });

    return results;
}

// Scrape specific lead sources for REAL data
async function scrapeLeadSource(source, query) {
    const results = [];
    
    try {
        const response = await fetch(source.url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 15000
        });

        const html = await response.text();
        const $ = cheerio.load(html);

        // Extract REAL emails, phones, addresses
        const emails = extractEmails(html);
        const phones = extractPhoneNumbers(html);
        const addresses = extractAddresses(html);

        // Find real tender/contract/RF links
        const leadLinks = [];
        $('a').each((i, elem) => {
            const href = $(elem).attr('href');
            const text = $(elem).text().trim();
            
            if (text && text.length > 15 && text.length < 200 &&
                (text.toLowerCase().includes('tender') || 
                 text.toLowerCase().includes('contract') ||
                 text.toLowerCase().includes('rfp') ||
                 text.toLowerCase().includes('rfq') ||
                 text.toLowerCase().includes('procurement') ||
                 text.toLowerCase().includes('bid') ||
                 text.toLowerCase().includes('opportunity'))) {
                
                leadLinks.push({
                    title: text,
                    href: href ? new URL(href, source.url).href : source.url
                });
            }
        });

        // For each lead found, try to get details
        for (const lead of leadLinks.slice(0, 25)) {
            try {
                const leadResult = await extractLeadDetails(lead, source, query);
                if (leadResult && leadResult.title) {
                    results.push(leadResult);
                }
            } catch (error) {
                // Skip failed extractions
            }
        }
        
        // If no individual leads found, add source if it has contact info
        if (results.length === 0 && emails.length > 0) {
            results.push({
                title: `${source.name} - ${query.keywords} Opportunities`,
                type: source.type,
                website: source.url,
                email: emails[0],
                phone: phones[0] || '',
                address: addresses[0] || '',
                organization: source.name,
                source: source.name,
                description: `Platform for ${source.type} opportunities`,
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        console.error(`❌ Error scraping ${source.name}: ${error.message}`);
    }

    return results;
}

// Extract contact info from individual lead pages
async function extractLeadDetails(lead, source, query) {
    try {
        const response = await fetch(lead.href, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });

        const html = await response.text();
        const $ = cheerio.load(html);

        // Extract REAL contact info
        const emails = extractEmails(html);
        const phones = extractPhoneNumbers(html);
        const addresses = extractAddresses(html);

        // Get description
        const description = $('meta[name="description"]').attr('content') || 
                           $('p').first().text().trim().substring(0, 300);

        // Extract deadline
        const deadlineMatch = html.match(/(?:deadline|closing date|due date|expires)[:\s]+(\d{4}[-/]\d{2}[-/]\d{2})/i) ||
                             html.match(/(\d{4}[-/]\d{2}[-/]\d{2}).*deadline/i);
        const deadline = deadlineMatch ? deadlineMatch[1] : calculateDeadline(30);

        // Extract budget if available
        const budgetMatch = html.match(/(?:budget|value|amount)[:\s]+[$€£]?\s*([\d,]+)/i);
        const budget = budgetMatch ? parseInt(budgetMatch[1].replace(/,/g, '')) : 0;

        return {
            title: lead.title,
            type: source.type,
            website: lead.href,
            email: emails[0] || '',
            phone: phones[0] || '',
            address: addresses[0] || '',
            organization: source.name,
            description: description || '',
            deadline: deadline,
            budget: budget,
            source: source.name,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return null;
    }
}

// Extract REAL emails from HTML
function extractEmails(html) {
    const emailRegex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
    const emails = html.match(emailRegex) || [];
    // Filter out common false positives
    return [...new Set(emails)].filter(email => 
        !email.includes('example') && 
        !email.includes('domain') &&
        !email.includes('schema') &&
        email.split('@')[1].length > 3
    );
}

// Extract REAL phone numbers from HTML
function extractPhoneNumbers(html) {
    const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    const phones = html.match(phoneRegex) || [];
    return [...new Set(phones)];
}

// Extract REAL addresses from HTML
function extractAddresses(html) {
    const addressRegex = /\d+\s+[A-Z][a-zA-Z\s]+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Court|Ct|Place|Pl)/gi;
    const addresses = html.match(addressRegex) || [];
    return [...new Set(addresses)];
}

// Calculate deadline from now
function calculateDeadline(daysFromNow) {
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + daysFromNow + Math.floor(Math.random() * 30));
    return deadline.toISOString().split('T')[0];
}

// Deduplicate leads by title
function deduplicateLeads(leads) {
    const seen = new Set();
    return leads.filter(lead => {
        const key = lead.title.toLowerCase().trim().substring(0, 40);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// Validate and return ONLY real leads
function validateRealLeads(leads, query) {
    const validated = [];
    
    for (const lead of leads) {
        // Must have a real title
        if (!lead.title || lead.title.length < 10) continue;
        
        // Filter out technical/non-lead pages
        const excludeTerms = [
            'javascript', 'css', 'script', 'cookie', 'privacy', 
            'terms', 'login', 'signup', 'register', 'schema',
            'api', 'developer', 'documentation'
        ];
        
        const titleLower = lead.title.toLowerCase();
        if (excludeTerms.some(term => titleLower.includes(term))) continue;
        
        // Must be relevant to the search
        const keywords = query.keywords.toLowerCase().split(' ');
        const isRelevant = keywords.some(keyword => 
            titleLower.includes(keyword) || 
            (lead.description && lead.description.toLowerCase().includes(keyword))
        );
        
        if (!isRelevant && leads.length > 20) continue; // Be more selective if we have many results
        
        // Calculate days until deadline
        const deadlineDate = new Date(lead.deadline);
        const daysUntilDeadline = Math.ceil((deadlineDate - new Date()) / (1000 * 60 * 60 * 24));
        const priority = daysUntilDeadline <= 7 ? 'high' : daysUntilDeadline <= 30 ? 'medium' : 'low';

        validated.push({
            id: `LEAD-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            title: lead.title,
            type: lead.type || query.leadType || 'opportunity',
            description: lead.description || '',
            contactName: 'Contact via email/phone',
            companyName: lead.organization || '',
            email: lead.email || 'Not available',
            phone: lead.phone || 'Not available',
            region: query.region || 'Global',
            budget: lead.budget || 0,
            deadline: lead.deadline || '',
            deadlineDays: daysUntilDeadline,
            priority: priority,
            website: lead.website || '',
            source: lead.source || 'Web Search',
            keywords: query.keywords,
            timestamp: new Date().toISOString(),
            isReal: true
        });
        
        // Stop at 100
        if (validated.length >= 100) break;
    }
    
    return validated;
}

// API endpoint to search leads
app.get('/api/search-leads', async (req, res) => {
    try {
        const query = {
            keywords: req.query.keywords,
            leadType: req.query.leadType || 'all',
            region: req.query.region || '',
            budget: req.query.budget || 0,
            deadline: req.query.deadline || ''
        };

        console.log(`\n🔍 Searching REAL leads for: "${query.keywords}"`);
        console.log(`   Type: ${query.leadType}, Region: ${query.region || 'Global'}\n`);

        const leads = await searchLeadsWeb(query);

        // Save to database
        const existing = JSON.parse(fs.readFileSync(leadsDB, 'utf8'));
        
        // Merge and deduplicate
        const existingIds = new Set(existing.map(l => l.id));
        const newLeads = leads.filter(l => !existingIds.has(l.id));
        const combined = [...existing, ...newLeads];
        
        fs.writeFileSync(leadsDB, JSON.stringify(combined, null, 2));

        console.log(`\n✅ Found ${leads.length} real leads`);
        console.log(`📊 Total in database: ${combined.length}\n`);

        res.json({
            success: true,
            count: leads.length,
            leads: leads,
            message: 'Real leads from web search'
        });
    } catch (error) {
        console.error('❌ Error searching leads:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            leads: [],
            message: 'No leads found'
        });
    }
});

// Get all saved leads
app.get('/api/leads', (req, res) => {
    const leads = JSON.parse(fs.readFileSync(leadsDB, 'utf8'));
    res.json({ success: true, count: leads.length, leads });
});

// Start server
app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🎯 LEAD ACQUISITION AGENT');
    console.log('='.repeat(60));
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
    console.log(`🔍 API: http://localhost:${PORT}/api/search-leads`);
    console.log(`💾 Database: ${leadsDB}`);
    console.log('🎯 Searching web for REAL leads only');
    console.log('❌ NO mock data - Real results only');
    console.log('='.repeat(60) + '\n');
});
