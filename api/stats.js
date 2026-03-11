import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const totalUses = (await redis.get('totalUses')) || 0;
      const totalFiles = (await redis.get('totalFiles')) || 0;
      return res.status(200).json({ totalUses, totalFiles });
    }

    if (req.method === 'POST') {
      const { fileCount } = req.body || {};
      const totalUses = await redis.incr('totalUses');
      const totalFiles = await redis.incrby('totalFiles', fileCount || 1);
      return res.status(200).json({ totalUses, totalFiles });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Stats API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
