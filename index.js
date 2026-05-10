const app = require('./server');

// Vercel automatically provides the correct port
const PORT = process.env.PORT;

app.listen(PORT, () => {
    console.log(`🚀 Server running on Vercel port ${PORT}`);
});
