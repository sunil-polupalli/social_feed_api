const express = require('express');
const db = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const postRoutes = require('./routes/postRoutes');
const userRoutes = require('./routes/userRoutes'); // <--- 1. Import

const app = express();
const PORT = 3000;

app.use(express.json());

app.use('/auth', authRoutes);
app.use('/posts', postRoutes);
app.use('/users', userRoutes); // <--- 2. Add this line

app.get('/', (req, res) => {
    res.json({ message: "Social Feed API is running! 🚀" });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});