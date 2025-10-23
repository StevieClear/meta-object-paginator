import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { shopifyApi, ApiVersion } from '@shopify/shopify-api';
import { PrismaSessionStorage } from '@shopify/shopify-app-session-storage-prisma';  // v12 named import
import '@shopify/shopify-api/adapters/node';  // v12 side-effect import for Node adapter

dotenv.config();

const app = express();
const prisma = new PrismaClient();

// Configure Shopify API (v12 public app)
const storage = new PrismaSessionStorage(prisma);  // v12 class instantiation
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SHOPIFY_SCOPES?.split(',') || ['read_metaobjects', 'read_products', 'read_files', 'write_app_proxy'],
  hostName: process.env.HOST_NAME || 'meta-object-paginator.vercel.app',
  isEmbeddedApp: true,
  apiVersion: ApiVersion.October25,  // v12 for 2025-10
  sessionStorage: storage,  // v12 storage config
  // Adapter loaded via import; no restResources/graphQL needed
});

// Middleware (webhooks commented out for brute force)
app.use(express.json());

// app.use(shopify.webhooks.middleware({ rawBody: true }));  // v12 webhook – commented to isolate crash

app.use(cors({
  origin: [
    'https://armadillo-labs.myshopify.com',
    'https://8thwonder.com',
    'https://siphowdy.com',
    'https://sipbeachbreak.com',
    'http://localhost:3000'
  ],
}));

// Health check (v12 session fetch)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    shop: req.query.shop || process.env.SHOPIFY_SHOP || 'MISSING',
    apiKeySet: !!process.env.SHOPIFY_API_KEY,
    environment: process.env.NODE_ENV || 'development' 
  });
});

// Fetch all COAs (uses v12 session)
async function fetchAllCOAs(session) {
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

// App proxy verification (v12 session)
async function verifyAppProxy(req, res, next) {
  try {
    const shop = req.query.shop;
    if (!shop) return res.status(400).json({ error: 'Missing shop' });

    const sessionId = shopify.session.getCurrentId({ rawRequest: req, rawResponse: res });
    const session = await shopify.session.fetch(sessionId);
    if (!session) return res.status(401).json({ error: 'Invalid session' });

    req.session = session;
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

  const authRoute = await shopify.auth.begin({ 
  callbackPath: '/auth/callback',
  isOnline: false,
  rawRequest: req,
  rawResponse: res,
  shop: shop
});
  res.redirect(authRoute);
});

app.get('/auth/callback', async (req, res) => {
  try {
   const session = await shopify.auth.validateAuth({ 
  callbackParams: req.query,
  rawRequest: req,
  rawResponse: res
});
    await shopify.session.storeSession(session);  // v12 store
    console.log('✅ Session stored for shop:', session.shop);
    res.redirect(`/app?shop=${session.shop}`);
  } catch (error) {
    console.error('OAuth error:', error.message);
    res.status(500).send(`OAuth failed: ${error.message}`);
  }
});

// App proxy route
app.all('/coas', verifyAppProxy, async (req, res) => {
  try {
    const coas = await fetchAllCOAs(req.session);
    res.json(coas);
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).json({ error: `Failed to fetch COAs: ${err.message}` });
  }
});

// API route for testing
app.get('/api/coas', verifyAppProxy, async (req, res) => {
  try {
    const coas = await fetchAllCOAs(req.session);
    res.json(coas);
  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ error: `Failed to fetch COAs: ${err.message}` });
  }
});

// Webhook routes (commented out for brute force)
 // app.post('/webhooks/app/uninstalled', shopify.webhooks.middleware(), async (req, res) => {
 //   const sessionId = req.body.session_id;
 //   await shopify.session.deleteSession(sessionId);
 //   res.status(200).send('OK');
 // });

 // app.post('/webhooks/app/scopes_update', shopify.webhooks.middleware(), async (req, res) => {
 //   res.status(200).send('OK');
 // });

// Export for Vercel
export default app;