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

// REAL Web Search
async function searchWeb(query, numResults = 50) {
    const allResults = [];
    
    const searches = [
        // DuckDuckGo
        async () => {
            const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
            const resp = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                timeout: 15000
            });
            const html = await resp.text();
            const $ = cheerio.load(html);
            const items = [];
            
            $('.result').each((i, elem) => {
                const title = $(elem).find('.result__a').first().text().trim();
                const snippet = $(elem).find('.result__snippet').first().text().trim();
                const url = $(elem).find('.result__a').first().attr('href');
                if (title && title.length > 10) {
                    items.push({ title, snippet, url });
                }
            });
            return items;
        },
        
        // Wikipedia
        async () => {
            const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=20&format=json`;
            const resp = await fetch(url, { timeout: 10000 });
            const data = await resp.json();
            return data[1].map((title, i) => ({
                title: title,
                snippet: data[2][i] || '',
                url: data[3][i] || ''
            }));
        }
    ];

    const results = await Promise.all(searches.map(fn => fn().catch(() => [])));
    
    for (const items of results) {
        for (const item of items) {
            const emails = extractEmails(item.snippet + ' ' + item.title);
            allResults.push({
                title: item.title,
                description: item.snippet,
                website: item.url,
                email: emails[0] || '',
                source: 'Web Search'
            });
        }
    }

    return allResults;
}

// Scrape lead websites
async function scrapeLeadWebsites(urls, query) {
    const results = [];
    
    for (const url of urls.slice(0, 30)) {
        try {
            const resp = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                timeout: 10000
            });
            
            const html = await resp.text();
            const emails = extractEmails(html);
            const phones = extractPhoneNumbers(html);
            const addresses = extractAddresses(html);
            
            if (emails.length > 0 || phones.length > 0) {
                const $ = cheerio.load(html);
                const title = $('title').text().trim() || url;
                const desc = $('meta[name="description"]').attr('content') || '';
                const deadline = extractDeadline(html);
                
                results.push({
                    title: title.substring(0, 150),
                    description: desc.substring(0, 300),
                    website: url,
                    email: emails[0] || '',
                    phone: phones[0] || '',
                    address: addresses[0] || '',
                    deadline: deadline,
                    source: 'Website Scrape'
                });
            }
            
            await new Promise(r => setTimeout(r, 500));
        } catch (error) {}
    }
    
    return results;
}

function extractEmails(text) {
    const regex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
    const matches = text.match(regex) || [];
    return [...new Set(matches)].filter(e => !e.includes('example') && e.split('@')[1].length > 3);
}

function extractPhoneNumbers(text) {
    const regex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    const matches = text.match(regex) || [];
    return [...new Set(matches)];
}

function extractAddresses(text) {
    const regex = /\d+\s+[A-Z][a-zA-Z\s]+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Court|Ct|Place|Pl)/gi;
    const matches = text.match(regex) || [];
    return [...new Set(matches)];
}

function extractDeadline(html) {
    const match = html.match(/(?:deadline|closing|due|expires)[:\s]+(\d{4}[-/]\d{2}[-/]\d{2})/i);
    return match ? match[1] : '';
}

function validateLeads(allLeads, query) {
    const seen = new Set();
    const valid = [];
    
    for (const lead of allLeads) {
        if (!lead.title || lead.title.length < 10) continue;
        
        const skip = ['javascript', 'css', 'cookie', 'privacy', 'terms', 'login', 'signup'];
        if (skip.some(s => lead.title.toLowerCase().includes(s))) continue;
        
        const key = lead.title.toLowerCase().trim().substring(0, 40);
        if (seen.has(key)) continue;
        seen.add(key);
        
        const keywords = query.keywords.toLowerCase().split(' ');
        const relevant = keywords.some(k => 
            lead.title.toLowerCase().includes(k) || 
            (lead.description && lead.description.toLowerCase().includes(k))
        );
        
        const deadlineDate = lead.deadline ? new Date(lead.deadline) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const daysUntil = Math.ceil((deadlineDate - new Date()) / (1000 * 60 * 60 * 24));
        const priority = daysUntil <= 7 ? 'high' : daysUntil <= 30 ? 'medium' : 'low';
        
        valid.push({
            id: `LEAD-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            title: lead.title,
            type: query.leadType || 'opportunity',
            description: lead.description || 'Real opportunity found via web search',
            contactName: 'Contact via email/phone',
            companyName: '',
            email: lead.email || 'Contact via website',
            phone: lead.phone || 'Contact via website',
            region: query.region || 'Global',
            budget: 0,
            deadline: lead.deadline || '',
            deadlineDays: daysUntil,
            priority: priority,
            website: lead.website || '',
            source: lead.source || 'Web Search',
            keywords: query.keywords,
            timestamp: new Date().toISOString()
        });
        
        if (valid.length >= 100) break;
    }
    
    return valid;
}

// API: Search leads
app.get('/api/search-leads', async (req, res) => {
    try {
        const query = {
            keywords: req.query.keywords,
            leadType: req.query.leadType || 'all',
            region: req.query.region || '',
            budget: req.query.budget || 0
        };

        console.log(`\n🔍 Searching REAL leads for: "${query.keywords}"`);

        const searchQuery = `${query.keywords} ${query.leadType !== 'all' ? query.leadType : 'tender RFP RFQ contract'} ${query.region} contact email deadline`;
        const searchResults = await searchWeb(searchQuery, 50);
        
        const urls = searchResults.filter(r => r.website).map(r => r.website);
        const scrapedResults = await scrapeLeadWebsites(urls, query);
        
        const allLeads = [...searchResults, ...scrapedResults];
        const leads = validateLeads(allLeads, query);

        const existing = JSON.parse(fs.readFileSync(leadsDB, 'utf8'));
        const existingIds = new Set(existing.map(l => l.id));
        const newLeads = leads.filter(l => !existingIds.has(l.id));
        const combined = [...existing, ...newLeads];
        fs.writeFileSync(leadsDB, JSON.stringify(combined, null, 2));

        console.log(`✅ Found ${leads.length} REAL leads`);
        console.log(`📊 Total in database: ${combined.length}\n`);

        res.json({
            success: true,
            count: leads.length,
            leads: leads,
            message: 'Real leads from web search'
        });
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            leads: [],
            message: 'No leads found'
        });
    }
});

// API: Get all saved leads
app.get('/api/leads', (req, res) => {
    const leads = JSON.parse(fs.readFileSync(leadsDB, 'utf8'));
    res.json({ success: true, count: leads.length, leads });
});

// Start
app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🎯 LEAD ACQUISITION AGENT');
    console.log('='.repeat(60));
    console.log(`🌐 http://localhost:${PORT}`);
    console.log('🔍 Searching REAL web - NO mock data');
    console.log('='.repeat(60) + '\n');
});
