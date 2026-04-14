# 🎯 Lead Acquisition Agent

An AI-powered web scraping agent that automatically searches the internet for sales leads, RFQs, RFPs, tenders, and business opportunities. Recovers up to 100 opportunities per day with full contact details.

## 🚀 Features

- **Real-time Web Search** - Searches DuckDuckGo, Bing, and specialized opportunity databases
- **Smart Data Extraction** - Extracts emails, phone numbers, deadlines, and budget estimates
- **Multiple Opportunity Types** - Tenders, RFPs, RFQs, Contracts, Sales Leads, Partnerships
- **Priority Scoring** - Automatically prioritizes urgent opportunities
- **Persistent Storage** - Saves all findings to local database
- **Beautiful Dashboard** - Modern, responsive UI with filtering and search history
- **One-Click Contact** - Email leads directly from the dashboard

## 📋 Retrieved Information

For each lead, the agent retrieves:
- ✅ Opportunity Title & Description
- ✅ Full Name / Contact Person
- ✅ Company / Organization Name
- ✅ Email Address
- ✅ Phone Number
- ✅ Physical Address
- ✅ Estimated Budget / Value
- ✅ Deadline & Days Remaining
- ✅ Priority Level (High/Medium/Low)
- ✅ Region/Country
- ✅ Source Platform

## 🛠️ Installation

```bash
# Clone the repository
git clone https://github.com/ThandoHlomuka/lead-acquisition-agent.git

# Navigate to directory
cd lead-acquisition-agent

# Install dependencies
npm install

# Start the server
npm start
```

## 🌐 Usage

1. Open http://localhost:3002 in your browser
2. Enter keywords (e.g., "IT Services", "Construction", "Consulting")
3. Select filters (type, region, budget, deadline)
4. Click "Search Opportunities"
5. Results appear with full contact details
6. Save, contact, or delete leads as needed

## 🔧 Tech Stack

- **Backend**: Node.js, Express
- **Web Scraping**: Cheerio, Node Fetch
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Database**: JSON file storage

## 📊 Architecture

```
┌─────────────────┐
│   Dashboard     │  ← User enters keywords
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Backend API    │  ← Searches web sources
└────────┬────────┘
         │
         ├─► DuckDuckGo
         ├─► Bing Search
         ├─► Tender Portals
         ├─► RFP Databases
         ├─► Government Procurement
         └─► Business Networks
              │
              ▼
         ┌─────────────┐
         │  Extract    │  ← Emails, phones, deadlines
         └──────┬──────┘
                │
                ▼
         ┌─────────────┐
         │   Save to   │  ← Local JSON database
         │   Database  │
         └─────────────┘
```

## 🎯 API Endpoints

- `GET /api/search-leads?keywords=technology&leadType=all&region=USA` - Search for leads
- `GET /api/leads` - Get all saved leads

## 📈 Capacity

- Up to **100 opportunities per search**
- Multiple searches per day
- Automatic deduplication
- Priority-based sorting
- Persistent storage across sessions

## 🔍 Opportunity Sources

The agent searches:
- **Tender Portals** - Government and private tender websites
- **RFP Platforms** - Request for Proposal databases
- **RFQ Systems** - Request for Quotation platforms
- **Contract Platforms** - Private contract opportunities
- **Business Networks** - Partnership and collaboration opportunities

## 🔒 Privacy & Ethics

- Respects website robots.txt
- Uses appropriate User-Agent headers
- Rate-limited requests
- No sensitive data scraping

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first.

## 📄 License

MIT
