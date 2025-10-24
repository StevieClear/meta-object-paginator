import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({
  origin: ['https://armadillo-labs.myshopify.com', 'http://localhost:3000']
}));

// Manual COA fetch (hardcoded token for now)
async function fetchAllCOAs(shop, accessToken) {
  const allCOAs = [];
  let after = null;

  do {
    const query = `
      query {
        metaobjects(type: "certificates_of_analysis", first: 50${after ? `, after: "${after}"` : ''}, sortKey: "updated_at", reverse: true) {
          edges {
            node {
              id
              date: field(key: "date") { value }
              product_name: field(key: "product_name") { value }
              batch_number: field(key: "batch_number") { value }
              pdf_link: field(key: "pdf_link") { value }
              best_by_date: field(key: "best_by_date") { value }
            }
            cursor
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const response = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query }),
    });

    const { data, errors } = await response.json();
    if (errors) throw new Error(errors[0]?.message || 'GraphQL error');

    const edges = data.metaobjects?.edges || [];
    edges.forEach(edge => {
      const coa = {
        id: edge.node.id,
        date: edge.node.date?.value,
        product: edge.node.product_name?.value,
        batch_number: edge.node.batch_number?.value,
        pdf_link: edge.node.pdf_link?.value,
        best_by_date: edge.node.best_by_date?.value,
      };
      if (coa.date && coa.product) allCOAs.push(coa);
    });

    after = data.metaobjects?.pageInfo?.hasNextPage ? data.metaobjects.pageInfo.endCursor : null;
  } while (after);

  return allCOAs.sort((a, b) => new Date(b.date) - new Date(a.date));
}

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    shop: req.query.shop || process.env.SHOPIFY_SHOP || 'MISSING',
    environment: process.env.NODE_ENV || 'development',
    message: 'Backend + COAs LIVE!' 
  });
});

app.get('/api/coas', async (req, res) => {
  try {
    const shop = req.query.shop;
    const token = process.env.SHOPIFY_ACCESS_TOKEN;  // Add to .env/Vercel
    if (!shop || !token) return res.status(400).json({ error: 'Missing shop or token' });
    
    const coas = await fetchAllCOAs(shop, token);
    res.json(coas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default app;