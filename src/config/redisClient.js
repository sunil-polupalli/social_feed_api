require('dotenv').config();
const redis = require('redis');

const client = redis.createClient({
    // Logic: Try Environment Variable (Docker) OR Use Default (Local)
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});

client.on('error', (err) => console.log('Redis Client Error', err));

async function connectRedis() {
    if (!client.isOpen) {
        await client.connect();
        console.log('✅ Connected to Redis Cache');
    }
}

connectRedis();

module.exports = client;