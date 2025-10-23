import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';  // Add this import
import { Shopify } from '@shopify/shopify-api';  // Add; install if missing: npm i @shopify/shopify-api@^11.0.0
import { sessionStorage } from '@shopify/shopify-app-session-storage-prisma';  // Add

dotenv.config();

const app = express();
const prisma = new PrismaClient();  // Prisma instance

// Configure Shopify API (public app)
const shopify = Shopify.Context.initialize({
  API_KEY: process.env.SHOPIFY_API_KEY,
  API_SECRET_KEY: process.env.SHOPIFY_API_SECRET,
  SCOPES: process.env.SHOPIFY_SCOPES?.split(',') || ['read_metaobjects', 'read_products', 'read_files', 'write_app_proxy'],
  HOST_NAME: process.env.HOST_NAME || 'meta-object-paginator.vercel.app',  // Update post-deploy
  IS_EMBEDDED_APP: true,
  API_VERSION: '2025-10',  // Match your const
  SESSION_STORAGE: sessionStorage({ client: prisma, tableName: 'sessions' }),  // Use Prisma
});

// Middleware (apply to all routes)
app.use(shopify.middleware.webhook({ rawBody: true }));  // For webhooks
app.use(express.json());

// Fix CORS (as before)
app.use(cors({
  origin: [
    'https://armadillo-labs.myshopify.com',  // Your dev store
    'https://8thwonder.com',
    'https://siphowdy.com',
    'https://sipbeachbreak.com',
    'http://localhost:3000'
  ],
}));

// Health check (updated)
app.get('/health', async (req, res) => {
  const sessionId = shopify.session.getCurrent({ rawRequest: req, rawResponse: res });
  const session = await shopify.session.fetch(sessionId);
  res.json({ 
    status: 'OK', 
    shop: req.query.shop || process.env.SHOPIFY_SHOP || 'MISSING',
    apiKeySet: !!process.env.SHOPIFY_API_KEY,
    sessionExists: !!session,
    environment: process.env.NODE_ENV || 'development' 
  });
});

// Fetch all COAs (updated: uses session token)
async function fetchAllCOAs(session) {  // Pass session
  if (!session?.accessToken) {
    throw new Error('No valid session token');
  }

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

    const response = await fetch(`https://${session.shop}/admin/api/2025-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': session.accessToken,
      },
      body: JSON.stringify({ query }),
    });

    const { data, errors } = await response.json();

    if (errors) {
      console.error('GraphQL errors:', JSON.stringify(errors, null, 2));
      throw new Error(`GraphQL query failed: ${errors[0]?.message || 'Unknown error'}`);
    }

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
      if (coa.date && coa.product) {
        allCOAs.push(coa);
      }
    });

    after = data.metaobjects?.pageInfo?.hasNextPage 
      ? data.metaobjects.pageInfo.endCursor 
      : null;
  } while (after);

  allCOAs.sort((a, b) => new Date(b.date) - new Date(a.date));
  return allCOAs;
}

// App proxy verification (updated for Shopify)
async function verifyAppProxy(req, res, next) {
  try {
    const shop = req.query.shop;
    if (!shop) return res.status(400).json({ error: 'Missing shop' });

    const sessionId = shopify.session.getCurrent({ rawRequest: req, rawResponse: res });
    const session = await shopify.session.fetch(sessionId);
    if (!session) return res.status(401).json({ error: 'Invalid session' });

    // Optional: HMAC check (uncomment once ready)
    // const signature = req.get('X-Shopify-Hmac-Sha256');
    // ... (your existing HMAC logic, but use session.shop)

    req.session = session;  // Attach for downstream use
    next();
  } catch (err) {
    console.error('Proxy auth error:', err);
    res.status(401).json({ error: 'Auth failed' });
  }
}

// Routes
app.get('/', async (req, res) => {
  const shop = req.query.shop || process.env.SHOPIFY_SHOP;
  if (!shop) return res.status(400).send('Missing shop parameter');

  const authRoute = await shopify.auth.beginAuth(
    req,
    res,
    shop,
    '/auth/callback',
    false  // Offline token
  );
  res.redirect(authRoute);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const session = await shopify.auth.validateAuthCallback(req, res, req.query);
    await shopify.session.storeSession(session);
    console.log('✅ Session stored for shop:', session.shop);
    res.redirect(`/app?shop=${session.shop}`);  // Or your embedded app URL
  } catch (error) {
    console.error('OAuth error:', error.message);
    res.status(500).send(`OAuth failed: ${error.message}`);
  }
});

// App proxy route (updated: uses session)
app.all('/coas', verifyAppProxy, async (req, res) => {
  try {
    const coas = await fetchAllCOAs(req.session);
    res.json(coas);
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).json({ error: `Failed to fetch COAs: ${err.message}` });
  }
});

// API route for testing (updated)
app.get('/api/coas', verifyAppProxy, async (req, res) => {  // Add verify for consistency
  try {
    const coas = await fetchAllCOAs(req.session);
    res.json(coas);
  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ error: `Failed to fetch COAs: ${err.message}` });
  }
});

// Webhook routes (add if using toml webhooks)
app.post('/webhooks/app/uninstalled', shopify.middleware.webhook(), async (req, res) => {
  const sessionId = req.body.session_id;
  await shopify.session.deleteSession(sessionId);
  res.status(200).send('OK');
});

app.post('/webhooks/app/scopes_update', shopify.middleware.webhook(), async (req, res) => {
  // Handle scope updates if needed
  res.status(200).send('OK');
});

// Export for Vercel
export default app;