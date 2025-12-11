const db = require('../config/db');
const redisClient = require('../config/redisClient'); // Import Redis

// POST /posts
exports.createPost = async (req, res) => {
    const { user_id, content } = req.body;

    try {
        // 1. Save Post to Database (Source of Truth)
        const result = await db.query(
            'INSERT INTO posts (user_id, content) VALUES ($1, $2) RETURNING *',
            [user_id, content]
        );
        const newPost = result.rows[0];

        // --- START FAN-OUT LOGIC ---
        
        // 2. Find all followers of this user
        const followers = await db.query(
            'SELECT follower_id FROM follows WHERE following_id = $1',
            [user_id]
        );

        // 3. Push the new post ID to each follower's Feed in Redis
        // key format: "feed:USER_ID"
        // score: timestamp (for sorting), member: post_id
        const timestamp = Date.now();
        
        // We use a loop to push to everyone (In production, use a background queue!)
        for (const row of followers.rows) {
            const feedKey = `feed:${row.follower_id}`;
            await redisClient.zAdd(feedKey, {
                score: timestamp,
                value: newPost.id.toString()
            });
        }
        
        // --- END FAN-OUT LOGIC ---

        res.status(201).json({
            message: "Post created and pushed to followers!",
            post: newPost
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    }
};

// GET /posts/feed (UNIVERSAL FIX)
exports.getFeed = async (req, res) => {
    const userId = req.query.user_id;
    // Force cursor to be a string or default to "+inf"
    const cursor = req.query.cursor ? String(req.query.cursor) : '+inf'; 

    if (!userId) {
        return res.status(400).json({ error: "Missing user_id" });
    }

    try {
        const feedKey = `feed:${userId}`;

        // FIX: We use .sendCommand() to bypass the library restrictions
        // This sends the raw command "ZREVRANGEBYSCORE" which your Redis server needs
        const postIds = await redisClient.sendCommand([
            'ZREVRANGEBYSCORE', 
            feedKey, 
            cursor, 
            '-inf', 
            'LIMIT', 
            '0', 
            '10'
        ]);

        if (postIds.length === 0) {
            return res.json({ feed: [], nextCursor: null });
        }

        const numericIds = postIds.map(id => parseInt(id, 10));

        const queryText = `
            SELECT p.id, p.content, u.username, p.created_at, 
                   EXTRACT(EPOCH FROM p.created_at) * 1000 as timestamp_ms
            FROM posts p
            JOIN users u ON p.user_id = u.id
            WHERE p.id = ANY($1::int[])
            ORDER BY p.created_at DESC
        `;
        
        const result = await db.query(queryText, [numericIds]);

        const lastItem = result.rows[result.rows.length - 1];
        const nextCursor = lastItem ? lastItem.timestamp_ms : null;

        res.json({ 
            feed: result.rows,
            nextCursor: nextCursor 
        });

    } catch (err) {
        console.error("Feed Error:", err);
        res.status(500).json({ error: "Error fetching feed" });
    }
};

// POST /posts/:id/like
exports.likePost = async (req, res) => {
    // We get the post ID from the URL (e.g., /posts/5/like)
    const postId = req.params.id;
    const { user_id } = req.body; // In real app, this comes from token

    const client = await db.connect(); // Get dedicated client for transaction

    try {
        await client.query('BEGIN'); // Start Transaction

        // 1. Try to insert into Likes table
        // This will FAIL if the user already liked the post (Unique Constraint)
        const insertLike = await client.query(
            'INSERT INTO likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
            [user_id, postId]
        );

        // If nothing was inserted, it means they already liked it.
        if (insertLike.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "You already liked this post" });
        }

        // 2. If insert worked, Increment the counter on Posts table
        await client.query(
            'UPDATE posts SET like_count = like_count + 1 WHERE id = $1',
            [postId]
        );

        await client.query('COMMIT'); // Commit changes
        res.json({ message: "Post liked successfully! ❤️" });

    } catch (err) {
        await client.query('ROLLBACK'); // Undo if error
        console.error(err);
        res.status(500).json({ error: "Database error" });
    } finally {
        client.release();
    }
};