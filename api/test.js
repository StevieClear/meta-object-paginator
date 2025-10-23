import express from 'express';
const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    shop: req.query.shop || 'MISSING',
    environment: process.env.NODE_ENV || 'development',
    message: 'Backend routing WORKS!' 
  });
});

app.get('/', (req, res) => {
  res.send('Backend LIVE - OAuth coming soon');
});

app.all('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Backend LIVE on http://localhost:${port}`);
});

export default app;