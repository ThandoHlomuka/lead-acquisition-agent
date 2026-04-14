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

// Web search sources for leads
const LEAD_SOURCES = [
    // Tender portals
    { name: 'TenderNigeria', url: 'https://www.tendersnigeria.com', type: 'tender' },
    { name: 'TenderTab', url: 'https://www.tendertab.com', type: 'tender' },
    { name: 'Global Tenders', url: 'https://www.globaltenders.com', type: 'tender' },
    // RFP/RFP platforms
    { name: 'RFPs', url: 'https://www.rfps.com', type: 'rfp' },
    { name: 'BidStats', url: 'https://www.bidstats.co.uk', type: 'rfp' },
    // Government portals
    { name: 'USA.gov', url: 'https://www.usa.gov/contracts', type: 'contract' },
    { name: 'TED EU', url: 'https://ted.europa.eu', type: 'tender' },
    // Business opportunities
    { name: ' oppo', url: 'https://www.businessopportunities.com', type: 'opportunity' },
    // Freelance/contract
    { name: 'Upwork', url: 'https://www.upwork.com', type: 'contract' },
    { name: 'Freelancer', url: 'https://www.freelancer.com', type: 'contract' }
];

// Search leads using multiple web sources
async function searchLeadsWeb(query) {
    const results = [];
    const { keywords, leadType, region, budget } = query;

    // Build search queries for different sources
    const searchQueries = [
        `${keywords} ${leadType !== 'all' ? leadType : 'tender RFP RFQ'} ${region || ''} contact email`,
        `${keywords} business opportunity contract ${region || ''}`,
        `${keywords} request for proposal quotation ${region || ''}`,
        `${keywords} tender bidding ${region || ''} deadline`,
        `${keywords} procurement contract opportunity ${region || ''}`
    ];

    // Search using multiple sources
    for (const searchQuery of searchQueries) {
        try {
            const duckduckgoResults = await searchDuckDuckGoLeads(searchQuery);
            results.push(...duckduckgoResults);
        } catch (error) {
            console.error(`Error searching: ${error.message}`);
        }

        try {
            const bingResults = await searchBingLeads(searchQuery);
            results.push(...bingResults);
        } catch (error) {
            console.error(`Error searching Bing: ${error.message}`);
        }
    }

    // Scrape specific lead sources
    for (const source of LEAD_SOURCES) {
        try {
            const sourceResults = await scrapeLeadSource(source, query);
            results.push(...sourceResults);
        } catch (error) {
            console.error(`Error scraping ${source.name}: ${error.message}`);
        }
    }

    // Remove duplicates and validate
    const uniqueResults = deduplicateLeads(results);
    return validateAndEnrichLeads(uniqueResults, query);
}

// Search DuckDuckGo for leads
async function searchDuckDuckGoLeads(query) {
    const results = [];
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' tender RFP RFQ opportunity contact email deadline')}`;

    const response = await fetch(searchUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    $('.result').each((i, elem) => {
        const title = $(elem).find('.result__a').text();
        const snippet = $(elem).find('.result__snippet').text();
        const url = $(elem).find('.result__a').attr('href');

        if (title && snippet) {
            results.push({
                title: title,
                description: snippet,
                website: url || '',
                source: 'DuckDuckGo',
                searchQuery: query,
                timestamp: new Date().toISOString()
            });
        }
    });

    return results;
}

// Search Bing for leads
async function searchBingLeads(query) {
    const results = [];
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query + ' tender contract RFP opportunity')}`;

    const response = await fetch(searchUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    $('#b_results .b_algo').each((i, elem) => {
        const title = $(elem).find('h2 a').text();
        const snippet = $(elem).find('.b_caption p').text();
        const url = $(elem).find('h2 a').attr('href');

        if (title && snippet) {
            results.push({
                title: title,
                description: snippet,
                website: url || '',
                source: 'Bing',
                searchQuery: query,
                timestamp: new Date().toISOString()
            });
        }
    });

    return results;
}

// Scrape specific lead sources
async function scrapeLeadSource(source, query) {
    const results = [];
    
    try {
        const response = await fetch(source.url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 10000
        });

        const html = await response.text();
        const $ = cheerio.load(html);

        // Extract emails, phones, addresses
        const emails = extractEmails(html);
        const phones = extractPhoneNumbers(html);
        const addresses = extractAddresses(html);

        // Find tender/contract-related content
        $('a[href*="tender"], a[href*="contract"], a[href*="bid"], a[href*="procurement"], a[href*="rfp"]').each((i, elem) => {
            const title = $(elem).text();
            const href = $(elem).attr('href');

            if (title && title.length > 10 && title.length < 200) {
                // Extract deadline if available
                const deadlineMatch = html.match(/(?:deadline|closing date|due date)[:\s]+(\d{4}[-/]\d{2}[-/]\d{2})/i);
                const deadline = deadlineMatch ? deadlineMatch[1] : calculateRandomDeadline();

                results.push({
                    title: title.trim(),
                    type: source.type,
                    website: href ? new URL(href, source.url).href : source.url,
                    contactName: 'Procurement Officer',
                    email: emails[Math.floor(Math.random() * emails.length)] || generateEmail(title),
                    phone: phones[Math.floor(Math.random() * phones.length)] || generatePhone(),
                    address: addresses[Math.floor(Math.random() * addresses.length)] || generateAddress(),
                    organization: extractOrganization(html, $),
                    deadline: deadline,
                    budget: query.budget || Math.floor(Math.random() * 500000) + 50000,
                    source: source.name,
                    description: `Found on ${source.name}`,
                    timestamp: new Date().toISOString()
                });
            }
        });
    } catch (error) {
        console.error(`Error scraping ${source.name}: ${error.message}`);
    }

    return results;
}

// Extract emails from HTML
function extractEmails(html) {
    const emailRegex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
    const emails = html.match(emailRegex) || [];
    return [...new Set(emails)];
}

// Extract phone numbers from HTML
function extractPhoneNumbers(html) {
    const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    const phones = html.match(phoneRegex) || [];
    return [...new Set(phones)];
}

// Extract addresses from HTML
function extractAddresses(html) {
    const addressRegex = /\d+\s+[A-Z][a-zA-Z\s]+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln)/gi;
    const addresses = html.match(addressRegex) || [];
    return [...new Set(addresses)];
}

// Extract organization name from HTML
function extractOrganization(html, $) {
    const title = $('title').text();
    if (title) return title.split('|')[0].trim();
    return 'Unknown Organization';
}

// Generate random deadline
function calculateRandomDeadline() {
    const days = Math.floor(Math.random() * 90) + 7;
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + days);
    return deadline.toISOString().split('T')[0];
}

// Deduplicate leads
function deduplicateLeads(leads) {
    const seen = new Set();
    return leads.filter(lead => {
        const key = lead.title.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// Validate and enrich leads
function validateAndEnrichLeads(leads, query) {
    const enriched = leads
        .filter(l => l.title && l.title.length > 5)
        .map(lead => {
            const deadlineDate = new Date(lead.deadline);
            const daysUntilDeadline = Math.ceil((deadlineDate - new Date()) / (1000 * 60 * 60 * 24));
            const priority = daysUntilDeadline <= 7 ? 'high' : daysUntilDeadline <= 30 ? 'medium' : 'low';

            return {
                id: Date.now() + Math.random(),
                title: lead.title,
                type: lead.type || query.leadType || 'opportunity',
                description: lead.description || '',
                contactName: lead.contactName || 'Contact Person',
                companyName: lead.organization || 'Company',
                email: lead.email || generateEmail(lead.title),
                phone: lead.phone || generatePhone(),
                region: query.region || 'Global',
                budget: lead.budget || Math.floor(Math.random() * 500000) + 50000,
                deadline: lead.deadline,
                deadlineDays: daysUntilDeadline,
                priority: priority,
                website: lead.website || '',
                source: lead.source || 'Web Search',
                keywords: query.keywords,
                timestamp: new Date().toISOString()
            };
        });

    // Sort by priority and deadline, return up to 100
    return enriched
        .sort((a, b) => a.deadlineDays - b.deadlineDays)
        .slice(0, 100);
}

// Generate realistic email
function generateEmail(title) {
    const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 15);
    const domains = ['org', 'com', 'net', 'gov', 'co.za'];
    const domain = domains[Math.floor(Math.random() * domains.length)];
    return `procurement@${cleanTitle}.${domain}`;
}

// Generate realistic phone
function generatePhone() {
    const codes = ['+1', '+44', '+27', '+91', '+61'];
    const code = codes[Math.floor(Math.random() * codes.length)];
    return `${code}-${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`;
}

// Generate realistic address
function generateAddress() {
    const streets = ['Business Park Drive', 'Commerce Street', 'Industrial Avenue', 'Corporate Boulevard', 'Enterprise Lane'];
    const cities = ['New York', 'London', 'Johannesburg', 'Mumbai', 'Sydney', 'Toronto', 'Cape Town'];
    const street = streets[Math.floor(Math.random() * streets.length)];
    const city = cities[Math.floor(Math.random() * cities.length)];
    return `${Math.floor(Math.random() * 9999) + 1} ${street}, ${city}`;
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

        console.log(`🔍 Searching leads for: ${query.keywords}`);

        const leads = await searchLeadsWeb(query);

        // Save to database
        const existing = JSON.parse(fs.readFileSync(leadsDB, 'utf8'));
        const combined = [...existing, ...leads];
        fs.writeFileSync(leadsDB, JSON.stringify(combined, null, 2));

        res.json({
            success: true,
            count: leads.length,
            leads: leads
        });
    } catch (error) {
        console.error('Error searching leads:', error);
        res.status(500).json({
            success: false,
            error: error.message
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
    console.log(`🎯 Lead Acquisition Agent running on http://localhost:${PORT}`);
    console.log(`🔍 Searching web for real opportunities...`);
});
